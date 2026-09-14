"use client";

import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui";
import {
  examGenerationProgress,
  examGenerationStage,
} from "@/lib/practice/exam-generation-progress";

/**
 * Loading for Jami-created questions, shown in place of the choices that
 * started it.
 *
 * Paced by elapsed time because the request that writes the questions reports
 * nothing until it is done; see `exam-generation-progress.ts`. It stays until
 * the session page replaces it, or the setup clears it on a failure.
 */
export default function ExamGenerationProgress({
  count,
  startedAt,
}: {
  count: number;
  startedAt: number;
}) {
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p
          role="status"
          aria-live="polite"
          className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-text-primary"
        >
          <span aria-hidden="true" className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
          {examGenerationStage(elapsed, count)}
        </p>
        <span aria-hidden="true" className="shrink-0 text-xs tabular-nums text-text-muted">
          {seconds}s
        </span>
      </div>
      <ProgressBar progress={examGenerationProgress(elapsed, count)} className="mt-3" />
      <p className="mt-2.5 text-xs leading-5 text-text-muted">
        This usually takes under a minute. Your session opens as soon as they&apos;re ready — keep
        this page open.
      </p>
    </div>
  );
}
