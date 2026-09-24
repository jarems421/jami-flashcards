"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * on each card. Preparing the first few buys a minute or two of runway, and the
 * rest of the queue is prepared behind them while they work: assets arrive as
 * they land, and a card reached before its own have arrived is simply asked a
 * way that needs none. So the visible wait is one small batch, and the queue is
 * fully prepared long before the student reaches the end of it.
 *
 * Five rather than three. Three was tuned for Smart Mix, where outrunning the
 * background pass costs nothing -- the card is asked a way that needs no
 * assets. A session pinned to Multiple Choice has no such fallback, so every
 * card the student reaches early is one they have to read a refusal about. The
 * requests run in parallel and the visible wait is capped either way, so the
 * extra two cost runway, not time.
 */
const PREPARATION_HEAD_START = 5;
/*
 * Nothing is waited for in Smart Mix, and only the first card in a fixed mode.
 *
 * The head start used to be a visible wait for all five cards, up to twenty
 * seconds, every time a session opened on new material. Smart Mix never needed
 * it: a card reached before its assets is asked a way that needs none, so the
 * head start now runs behind the first card instead of in front of it. A
 * session pinned to one mode does need its first card -- there is nothing else
 * to show -- so it waits for that card alone, and the next four arrive while
 * the student answers it.
 */
/**
 * One card a request for the head start, all of them at once.
 *
 * The background pass batches for cost, and this one does the opposite on
 * purpose. Three cards in a single request finish together, so the bar sat at
 * "0 of 3 ready" for the whole twenty-second wait and then jumped to done --
 * indistinguishable from a hung screen, which is what it was reported as. Three
 * requests of one card each land separately and the bar moves three times.
 *
 * It is also faster: output tokens dominate the latency of a call, so three
 * one-card requests in parallel return in roughly the time the slowest single
 * card takes rather than the sum of all three.
 */
const PREPARATION_HEAD_START_CHUNK_SIZE = 1;
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
 * The card being waited on, plus the next two.
 *
 * Small on purpose: this request is the one a student is actually watching, and
 * output tokens dominate its latency, so every card added to it lengthens the
 * wait they can see. Three covers the gap until the background pass catches up
 * without turning a wait into a batch job.
 */
const JUST_IN_TIME_BATCH_SIZE = 3;

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
  const jobsRef = useRef(new Set<{ value: boolean }>());
  const epochRef = useRef(0);
  const stoppedRef = useRef(false);
  const cancel = useCallback(() => {
    stoppedRef.current = true;
    epochRef.current += 1;
    for (const stop of jobsRef.current) stop.value = true;
    jobsRef.current.clear();
    skipPreparationRef.current?.();
  }, []);
  useEffect(() => { stoppedRef.current = false; return cancel; }, [cancel]);

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
      /** Not waited for: prepared first, one card a request, behind the session. */
      headStart: Card[];
      remainder: Card[];
    }> => {
      const empty = { assets: {}, headStart: [] as Card[], remainder: [] as Card[] };
      cancel();
      stoppedRef.current = false;
      const epoch = epochRef.current;
      if (!studyModesEnabled || queue.length === 0) return empty;
      if (typeof navigator !== "undefined" && !navigator.onLine) return empty;

      // Only cards a model would actually improve. A deck of formulas or
      // numeric answers passes straight through here, spends nothing, and
      // starts with no wait at all.
      const worthPreparing = queue.filter((card) =>
        needsStudyAssetPreparation(card, modePolicy)
      );
      if (worthPreparing.length === 0) return empty;

      const known = await loadStudyAssets(worthPreparing);
      if (epoch !== epochRef.current) return empty;
      const missing = worthPreparing
        .filter((card) => !known[card.id] || known[card.id].repairRequested)
        .slice(0, MAX_PREPARED_CARDS_PER_SESSION);
      if (missing.length === 0) return { assets: known, headStart: [], remainder: [] };

      const headStart = missing.slice(0, PREPARATION_HEAD_START);
      const remainder = missing.slice(PREPARATION_HEAD_START);
      if (modePolicy.kind === "smart") return { assets: known, headStart, remainder };

      const [first, ...rest] = headStart;
      setPreparation({ prepared: 0, total: 1 });

      const stop = { value: false };
      jobsRef.current.add(stop);
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
          runPreparationChunks([first], {
            chunkSize: PREPARATION_HEAD_START_CHUNK_SIZE,
            concurrency: 1,
            stop,
            onChunkDone: () => setPreparation((prev) => (prev ? { ...prev, prepared: 1 } : prev)),
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
        /*
         * Take the panel down here rather than leaving it to the caller.
         *
         * The caller clears it once this whole function returns, which is one
         * read of the cache later -- so pressing Start now left the overlay up
         * for a further round trip while the button appeared to have done
         * nothing. The waiting is over the moment the race settles, whether it
         * settled by finishing, by expiring or by being skipped.
         */
        setPreparation(null);
        jobsRef.current.delete(stop);
      }

      const refreshed = await loadStudyAssets([first]);
      if (epoch !== epochRef.current) return empty;
      return { assets: { ...known, ...refreshed }, headStart: rest, remainder };
    },
    [modePolicy, studyModesEnabled, cancel]
  );

  /**
   * Prepare one card now, because the student is looking at it.
   *
   * The head start covers the first few cards and the background pass catches
   * the rest, but a student who answers faster than the pass can run still
   * arrives at a card with nothing prepared -- and in a session locked to one
   * mode, that card had nowhere to go but a panel apologising for itself. This
   * is the same preparation for a single card, asked for at the moment it is
   * needed, so the wait is a few seconds on one card rather than a question the
   * student cannot have.
   */
  /**
   * Prepare the card a student is waiting on, and the next few behind it.
   *
   * One card a request was the whole cost of outrunning the background pass: a
   * student who reached an unprepared card waited for it, answered it, and then
   * reached the next unprepared card and waited again. In a session pinned to
   * Multiple Choice -- where there is no other way to ask the card -- that is a
   * refusal panel every time, which is what made a fifteen-card session feel
   * like six.
   *
   * The look-ahead rides along in the same request, so it costs no extra slot
   * of the daily allowance and no extra wait: the student is already waiting
   * for the first card, and the next two arrive with it. Only cards from the
   * same deck, because the endpoint checks ownership one deck at a time.
   */
  const prepareCardNow = useCallback(async (card: Card, lookAhead: readonly Card[] = []) => {
    if (!studyModesEnabled) return null;
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    const stop = { value: false };
    const epoch = epochRef.current;
    jobsRef.current.add(stop);

    const batch = [
      card,
      ...lookAhead.filter((next) => next.deckId === card.deckId && next.id !== card.id),
    ].slice(0, JUST_IN_TIME_BATCH_SIZE);

    try {
      await prepareStudyAssets({ deckId: card.deckId, cardIds: batch.map((item) => item.id) });
      const refreshed = await loadStudyAssets(batch);
      if (stop.value || epoch !== epochRef.current) return null;
      onAssetsReady(refreshed);
      return refreshed[card.id] ?? null;
    } catch (error) {
      console.warn("Jami could not prepare this card in time.", error);
      return null;
    } finally {
      jobsRef.current.delete(stop);
    }
  }, [onAssetsReady, studyModesEnabled]);

  /**
   * Keep preparing after the session has opened.
   *
   * Nothing waits on this. Assets are merged in as they land, so a card the
   * student has not reached yet gets the better question, and one they reach
   * first is asked a way that needs no preparation.
   */
  const prepareRemainingAssets = useCallback(async (remainder: Card[], headStart: Card[] = []) => {
    const pending = [...headStart, ...remainder];
    if (pending.length === 0 || stoppedRef.current) return;
    const stop = { value: false };
    const epoch = epochRef.current;
    jobsRef.current.add(stop);
    /*
     * Published as it lands, rather than once at the end.
     *
     * This used to read the assets a single time, after every chunk of the
     * remainder had finished. On a long queue that is minutes away, so the
     * first chunk sat prepared and unusable while the student worked through
     * cards that could already have been asked as Gap Fill or Multiple
     * Choice -- and the session kept serving the two modes that need no assets
     * at all. Publishing per chunk means the modes widen as the queue is read
     * rather than all at once, long after it matters.
     *
     * Guarded against overlap so a slow read cannot stack up behind the
     * chunks, and a failed one is simply retried by the next chunk.
     */
    let refreshing = false;
    const publish = async () => {
      if (refreshing || stop.value || epoch !== epochRef.current) return;
      refreshing = true;
      try {
        const landed = await loadStudyAssets(pending);
        if (!stop.value && epoch === epochRef.current) onAssetsReady(landed);
      } catch {
        // The next chunk publishes again; a read that failed is not fatal.
      } finally {
        refreshing = false;
      }
    };

    try {
      // The cards nearest the student first, each on its own so each lands alone.
      await runPreparationChunks(headStart, {
        chunkSize: PREPARATION_HEAD_START_CHUNK_SIZE,
        concurrency: PREPARATION_HEAD_START,
        stop,
        onChunkDone: () => {
          void publish();
        },
      });
      await publish();
      await runPreparationChunks(remainder, {
        chunkSize: PREPARATION_CHUNK_SIZE,
        concurrency: PREPARATION_CONCURRENCY,
        stop,
        onChunkDone: () => {
          void publish();
        },
      });
      await publish();
    } catch (error) {
      console.warn("Background study preparation stopped.", error);
    } finally {
      jobsRef.current.delete(stop);
    }
  }, [onAssetsReady]);

  return {
    cancel,
    /** Non-null only while a student is being kept waiting. */
    progress: preparation,
    clearProgress: useCallback(() => setPreparation(null), []),
    skip: useCallback(() => skipPreparationRef.current?.(), []),
    prepareSessionAssets,
    prepareRemainingAssets,
    prepareCardNow,
  };
}
