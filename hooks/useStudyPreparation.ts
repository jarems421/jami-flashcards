"use client";

import { useCallback, useRef, useState } from "react";
import type { StudyAsset } from "@/lib/ai/study-assets";
import type { Card } from "@/lib/study/cards";
import { needsStudyAssetPreparation } from "@/lib/study/mode-eligibility";
import type { StudyModePolicy } from "@/lib/study/study-modes";
import {
  loadStudyAssets,
  prepareStudyAssets,
} from "@/services/study/study-assets";

export type StudyPreparationProgress = {
  prepared: number;
  total: number;
};

/*
 * Preparation is a head start, not a wait for the whole queue.
 *
 * Measured against the worker model, six cards take 18-21 seconds on the fast
 * endpoint and 39-46 on the fallback, and running four requests at once pushed
 * most of them onto the slow one -- 24 cards took 46 seconds of wall clock for
 * a bar that was supposed to finish in 25. No batch size fixes that, because
 * the model is simply not fast enough to prepare a whole session while somebody
 * watches.
 *
 * What does fix it is that the student is about to spend ten to twenty seconds
 * on each card. Preparing the first three buys a minute of runway, and the rest
 * of the queue is prepared behind them while they work: assets arrive as they
 * land, and a card reached before its own have arrived is simply asked a way
 * that needs none. So the visible wait is one small batch, and the queue is
 * fully prepared long before the student reaches the end of it.
 */
const PREPARATION_HEAD_START = 3;
/** The visible wait, and the only clock a student ever sees. */
const PREPARATION_BUDGET_MS = 20_000;
/**
 * Twelve cards a request for the background pass, two requests at a time.
 *
 * The server splits each request into two batches, so this is four model calls
 * in flight -- measured at 18-42 seconds for the wave, which is nothing when
 * the student is on card one of fifty. Twelve rather than six because each
 * request costs a slot of the daily preparation allowance, and halving the
 * number of requests halves what a session of new cards spends.
 */
const PREPARATION_CHUNK_SIZE = 12;
const PREPARATION_CONCURRENCY = 2;
/** A queue longer than this is prepared as far as it goes and no further. */
const MAX_PREPARED_CARDS_PER_SESSION = 100;

/**
 * Send a set of cards to the preparation endpoint, a chunk at a time.
 *
 * Chunks are grouped by deck because the endpoint verifies ownership one deck
 * at a time. `stop` is read before each chunk rather than passed to fetch: a
 * request already sent is allowed to finish and cache its answer, because the
 * work is worth keeping even once nobody is waiting for it.
 */
async function runPreparationChunks(
  cards: Card[],
  options: {
    chunkSize: number;
    concurrency: number;
    stop: { value: boolean };
    onChunkDone?: (count: number) => void;
  }
) {
  const byDeck = new Map<string, string[]>();
  for (const card of cards) {
    byDeck.set(card.deckId, [...(byDeck.get(card.deckId) ?? []), card.id]);
  }
  const chunks: Array<{ deckId: string; cardIds: string[] }> = [];
  for (const [deckId, ids] of byDeck) {
    for (let at = 0; at < ids.length; at += options.chunkSize) {
      chunks.push({ deckId, cardIds: ids.slice(at, at + options.chunkSize) });
    }
  }
  if (chunks.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const position = cursor;
      cursor += 1;
      if (options.stop.value || position >= chunks.length) return;
      const chunk = chunks[position];
      try {
        await prepareStudyAssets(chunk);
      } catch (error) {
        // One chunk failing usually means the daily limit or the provider, and
        // both apply to every other chunk too. Stop rather than find out again.
        console.warn("Study preparation was cut short.", error);
        options.stop.value = true;
      }
      options.onChunkDone?.(chunk.cardIds.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, chunks.length) }, worker)
  );
}

/**
 * Getting cards ready to be asked well, without making anyone wait for it.
 *
 * Lifted out of the study page because it is a self-contained job with its own
 * clock, its own concurrency and its own reasons, and the page was long enough
 * that none of that was findable inside it.
 *
 * The caller does two things with this: it awaits `prepareSessionAssets` before
 * building the queue, and it starts `prepareRemainingAssets` afterwards without
 * awaiting. `progress` is non-null only while somebody is actually being kept
 * waiting, so a session with nothing to prepare renders no panel at all.
 */
export function useStudyPreparation(input: {
  enabled: boolean;
  modePolicy: StudyModePolicy;
  /** Called when background preparation lands more assets. */
  onAssetsReady: (assets: Record<string, StudyAsset>) => void;
}) {
  const { enabled: studyModesEnabled, modePolicy, onAssetsReady } = input;
  const [preparation, setPreparation] = useState<StudyPreparationProgress | null>(
    null
  );
  /** Set while preparing so Start now can stop the wait without cancelling it. */
  const skipPreparationRef = useRef<(() => void) | null>(null);

  /**
   * Read the queue's new cards: a few before the session opens, the rest behind
   * the student while they work.
   *
   * Everything good about the non-Classic modes comes from here. Without it a
   * gap is chosen by a rule that can only see which words look important, and a
   * multiple-choice question has no wrong answers worth offering -- which is
   * why multiple choice is not built at all for an unprepared card rather than
   * being built badly.
   *
   * Cached cards never leave the browser, so a deck studied before returns
   * instantly and this does no work at all. What is left is split: the first
   * few are waited for, and the remainder is handed back as a promise the
   * caller starts and does not await.
   */
  const prepareSessionAssets = useCallback(
    async (
      queue: Card[]
    ): Promise<{
      assets: Record<string, StudyAsset>;
      remainder: Card[];
    }> => {
      const empty = { assets: {}, remainder: [] as Card[] };
      if (!studyModesEnabled || queue.length === 0) return empty;
      if (typeof navigator !== "undefined" && !navigator.onLine) return empty;

      // Only cards a model would actually improve. A deck of formulas or
      // numeric answers passes straight through here, spends nothing, and
      // starts with no wait at all.
      const worthPreparing = queue.filter((card) =>
        needsStudyAssetPreparation(card, modePolicy)
      );
      if (worthPreparing.length === 0) return empty;

      const known = await loadStudyAssets(worthPreparing.map((card) => card.id));
      const missing = worthPreparing
        .filter((card) => !known[card.id])
        .slice(0, MAX_PREPARED_CARDS_PER_SESSION);
      if (missing.length === 0) return { assets: known, remainder: [] };

      const headStart = missing.slice(0, PREPARATION_HEAD_START);
      const remainder = missing.slice(PREPARATION_HEAD_START);

      setPreparation({ prepared: 0, total: headStart.length });

      const stop = { value: false };
      let expiryTimer = 0;
      const expiry = new Promise<void>((resolve) => {
        expiryTimer = window.setTimeout(() => {
          stop.value = true;
          resolve();
        }, PREPARATION_BUDGET_MS);
      });
      const skipped = new Promise<void>((resolve) => {
        skipPreparationRef.current = () => {
          stop.value = true;
          resolve();
        };
      });

      try {
        await Promise.race([
          runPreparationChunks(headStart, {
            chunkSize: PREPARATION_HEAD_START,
            concurrency: 1,
            stop,
            onChunkDone: (count) =>
              setPreparation((prev) =>
                prev
                  ? { ...prev, prepared: Math.min(prev.total, prev.prepared + count) }
                  : prev
              ),
          }),
          expiry,
          skipped,
        ]);
      } finally {
        // A request already in flight is left to finish. It cannot reach this
        // session any more, but what it writes is cached, so the work is
        // waiting the next time rather than thrown away.
        window.clearTimeout(expiryTimer);
        skipPreparationRef.current = null;
      }

      const refreshed = await loadStudyAssets(headStart.map((card) => card.id));
      return { assets: { ...known, ...refreshed }, remainder };
    },
    [modePolicy, studyModesEnabled]
  );

  /**
   * Keep preparing after the session has opened.
   *
   * Nothing waits on this. Assets are merged in as they land, so a card the
   * student has not reached yet gets the better question, and one they reach
   * first is asked a way that needs no preparation.
   */
  const prepareRemainingAssets = useCallback(async (remainder: Card[]) => {
    if (remainder.length === 0) return;
    try {
      await runPreparationChunks(remainder, {
        chunkSize: PREPARATION_CHUNK_SIZE,
        concurrency: PREPARATION_CONCURRENCY,
        stop: { value: false },
      });
      const refreshed = await loadStudyAssets(remainder.map((card) => card.id));
      onAssetsReady(refreshed);
    } catch (error) {
      console.warn("Background study preparation stopped.", error);
    }
  }, [onAssetsReady]);

  return {
    /** Non-null only while a student is being kept waiting. */
    progress: preparation,
    clearProgress: useCallback(() => setPreparation(null), []),
    skip: useCallback(() => skipPreparationRef.current?.(), []),
    prepareSessionAssets,
    prepareRemainingAssets,
  };
}
