"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, FeedbackBanner, ProgressBar } from "@/components/ui";
import { auth } from "@/services/firebase/client";
import type { ExamSheetBackfillSkip } from "@/services/practice/exam-sheet-backfill.server";

type PaperRow = {
  paperId: string;
  title: string;
  questions: number;
  withPages: number;
};

type BackfillResult = {
  paperId: string;
  total: number;
  next: number | null;
  rendered: number;
  reused: number;
  alreadyDone: number;
  skipped: ExamSheetBackfillSkip[];
};

async function internalRequest(path: string, init?: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in first.");
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-jami-firebase-id-token": await user.getIdToken(),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "request_failed");
  return data ?? {};
}

const SKIP_LABELS: Record<ExamSheetBackfillSkip["reason"], string> = {
  no_printed_crop: "No printed crop to work from",
  scheme_missing: "Its mark scheme is missing or a different version",
  render_failed: "The page could not be rendered",
};

/**
 * Giving papers already in the bank the pages a student writes on.
 *
 * Deliberately not a re-ingest. Re-ingesting replaces a question document
 * whole, which takes its human spot-check with it -- so every paper somebody
 * had sampled would go back to unsampled and the corpus would stop serving
 * until all of them had been read again. This calls no model, changes no
 * wording, and adds only the page images and the room the board left after the
 * question. A question it cannot prove it has understood is left alone and
 * listed here.
 */
export default function ExamSheetBackfillPanel() {
  const [papers, setPapers] = useState<PaperRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rendered, setRendered] = useState(0);
  const [reused, setReused] = useState(0);
  const [skipped, setSkipped] = useState<Array<ExamSheetBackfillSkip & { paperId: string }>>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await internalRequest("/api/internal/exam-questions/sheets");
      setPapers((data.papers as PaperRow[]) ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The papers could not be listed.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const outstanding = (papers ?? []).filter((paper) => paper.withPages < paper.questions);
  const questionsLeft = outstanding.reduce(
    (total, paper) => total + (paper.questions - paper.withPages),
    0
  );

  const run = async () => {
    setRunning(true);
    setError("");
    setRendered(0);
    setReused(0);
    setSkipped([]);
    setProgress({ done: 0, total: questionsLeft });
    let done = 0;
    let total = 0;
    let carried = 0;
    try {
      for (const paper of outstanding) {
        setCurrent(paper.title);
        let from = 0;
        // Walked a slice at a time, so no single request has to render a whole
        // paper of A4 at writing resolution.
        for (let step = 0; step < 200; step += 1) {
          const data = await internalRequest("/api/internal/exam-questions/sheets", {
            method: "POST",
            body: JSON.stringify({ paperId: paper.paperId, from, limit: 4 }),
          });
          const result = data.result as BackfillResult;
          total += result.rendered;
          carried += result.reused;
          done += result.rendered + result.reused + result.alreadyDone + result.skipped.length;
          setRendered(total);
          setReused(carried);
          setProgress({ done, total: questionsLeft });
          if (result.skipped.length) {
            setSkipped((current) => [
              ...current,
              ...result.skipped.map((entry) => ({ ...entry, paperId: paper.paperId })),
            ]);
          }
          if (result.next === null) break;
          from = result.next;
        }
      }
      setCurrent("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The pages could not be rendered.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card padding="lg">
      <h2 className="text-lg font-semibold text-text-primary">Give the bank its pages</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
        Renders each question&rsquo;s own pages of paper from the board&rsquo;s PDF, which is already
        stored, so a student can answer on the paper rather than beside it. It calls no model and
        costs nothing. Nothing else about a question changes — its wording, its mark scheme, its
        review and its spot-check are left exactly as they are, and sessions already running are
        unaffected.
      </p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
        A question is repaginated only where the regions behind its crop can be proved, by
        reproducing the version it is stored under. Where they cannot — a paper ingested before the
        region code was last fixed — it keeps the crop it already has, whole, as a single writable
        page. That asserts nothing new about the question: it is the same approved image, at the
        same path.
      </p>

      {papers === null ? (
        <p className="mt-4 text-sm text-text-muted">Reading the bank…</p>
      ) : (
        <p className="mt-4 text-sm text-text-secondary">
          {questionsLeft === 0
            ? "Every question in the bank already has its pages."
            : `${questionsLeft} question${questionsLeft === 1 ? "" : "s"} across ${outstanding.length} paper${
                outstanding.length === 1 ? "" : "s"
              } still to do.`}
        </p>
      )}

      {running || progress.total > 0 ? (
        <div className="mt-4 space-y-2">
          <ProgressBar
            progress={progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
          />
          <p className="text-xs text-text-muted" aria-live="polite">
            {current ? `${current} — ` : ""}
            {rendered} repaginated
            {reused ? `, ${reused} kept as one page` : ""}
            {skipped.length ? `, ${skipped.length} left alone` : ""}
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <Button type="button" disabled={running || questionsLeft === 0} onClick={() => void run()}>
          {running ? "Rendering…" : "Render the missing pages"}
        </Button>
      </div>

      {error ? (
        <div className="mt-4">
          <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} />
        </div>
      ) : null}

      {reused > 0 ? (
        <p className="mt-3 text-xs text-text-muted">
          {reused} question{reused === 1 ? "" : "s"} kept the crop {reused === 1 ? "it" : "they"}{" "}
          already had, as one tall page rather than separate ones. Extra sheets still work behind{" "}
          {reused === 1 ? "it" : "them"}.
        </p>
      ) : null}

      {skipped.length ? (
        <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <h3 className="text-sm font-semibold text-text-primary">
            Left alone ({skipped.length})
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            These keep the layout they already had. A question is only written to when its stored
            version can be reproduced exactly, which is what proves the right piece of paper is
            being rendered under it.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-text-secondary">
            {skipped.slice(0, 40).map((entry) => (
              <li key={`${entry.paperId}:${entry.questionId}`}>
                <span className="font-medium text-text-primary">{entry.label || entry.questionId}</span>
                {" — "}
                {SKIP_LABELS[entry.reason]}
                {entry.detail ? ` (${entry.detail})` : ""}
              </li>
            ))}
          </ul>
          {skipped.length > 40 ? (
            <p className="mt-2 text-xs text-text-muted">…and {skipped.length - 40} more.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
