"use client";

import { useCallback, useEffect, useState } from "react";
import { auth } from "@/services/firebase/client";
import { Button, Card, FeedbackBanner, Select } from "@/components/ui";
import { ENGLAND_MATHS_AND_SCIENCE } from "@/lib/practice/exam-corpus-plan";
import { boardHasSourcePattern } from "@/lib/practice/exam-source-patterns";
import { EXAM_BOARD_LABELS } from "@/lib/practice/exam-formats";
import {
  EXAM_INGESTION_STAGE_LABELS,
  isExamIngestionFinished,
  type ExamIngestionJob,
} from "@/lib/practice/exam-ingestion-job";

/** Roughly what one paper costs to read, from measured runs. */
const COST_PER_PAPER_USD = 0.012;

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

type BatchState = {
  jobIds: string[];
  papersFound: number;
  papersWithoutSources: number;
  done: number;
  failed: number;
  published: number;
  needsReview: number;
};

/**
 * Ingesting a whole course, from one place.
 *
 * Finding the papers costs nothing and happens first, so the number of papers
 * -- and therefore what the run will cost -- is on screen before a single paid
 * call is made. Then each paper's job is walked to completion one stage at a
 * time, and stopping halfway leaves everything already ingested ingested.
 */
export default function ExamRolloutPanel({ onIngested }: { onIngested?: () => void }) {
  const years = [2024, 2023, 2022, 2021, 2020];
  const [targetKey, setTargetKey] = useState(
    `${ENGLAND_MATHS_AND_SCIENCE[0].board}:${ENGLAND_MATHS_AND_SCIENCE[0].specificationId}`
  );
  const [fromYear, setFromYear] = useState(2023);
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState("");
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");

  const target = ENGLAND_MATHS_AND_SCIENCE.find(
    (item) => `${item.board}:${item.specificationId}` === targetKey
  );

  const seed = async () => {
    setSeeding(true);
    setError("");
    try {
      const data = await internalRequest("/api/internal/exam-questions/rollout", {
        method: "POST",
        body: JSON.stringify({ action: "seed" }),
      });
      setSeeded(`${Number(data.seeded ?? 0)} course components are in the catalogue.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The catalogue could not be seeded.");
    } finally {
      setSeeding(false);
    }
  };

  const walk = useCallback(async (jobId: string) => {
    let job: ExamIngestionJob | null = null;
    for (let step = 0; step < 60; step += 1) {
      const data = await internalRequest(
        `/api/internal/exam-questions/ingest/${encodeURIComponent(jobId)}`,
        { method: "POST" }
      );
      job = data.job as ExamIngestionJob;
      setCurrent(EXAM_INGESTION_STAGE_LABELS[job.stage]);
      if (isExamIngestionFinished(job)) break;
    }
    return job;
  }, []);

  const run = async (dryRun: boolean) => {
    if (!target) return;
    setRunning(true);
    setError("");
    setBatch(null);
    try {
      const queued = await internalRequest("/api/internal/exam-questions/rollout", {
        method: "POST",
        body: JSON.stringify({
          board: target.board,
          specificationId: target.specificationId,
          years: years.filter((year) => year >= fromYear),
          dryRun,
        }),
      });
      const found = queued.batch as {
        jobIds: string[];
        papersFound: number;
        papersWithoutSources: number;
      };
      const state: BatchState = {
        ...found,
        done: 0,
        failed: 0,
        published: 0,
        needsReview: 0,
      };
      setBatch({ ...state });
      for (const jobId of found.jobIds) {
        const job = await walk(jobId);
        if (!job) continue;
        state.done += job.stage === "done" ? 1 : 0;
        state.failed += job.stage === "failed" ? 1 : 0;
        state.published += job.published ?? 0;
        state.needsReview += job.needsReview ?? 0;
        setBatch({ ...state });
      }
      setCurrent("");
      if (!dryRun) onIngested?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The rollout could not run.");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    setBatch(null);
    setCurrent("");
  }, [targetKey, fromYear]);

  const patterned = target ? boardHasSourcePattern(target.board) : false;

  return (
    <Card padding="lg">
      <h2 className="text-lg font-semibold text-text-primary">Ingest a whole course</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
        Finding the papers costs nothing and happens first, so you can see how many there are before
        anything is read. Each paper is then ingested in stages, and stopping partway keeps whatever
        has already been done.
      </p>

      {error ? (
        <div className="mt-4">
          <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Select
          label="Course"
          value={targetKey}
          containerClassName="sm:flex-1"
          onChange={(event) => setTargetKey(event.target.value)}
        >
          {ENGLAND_MATHS_AND_SCIENCE.map((item) => (
            <option key={`${item.board}:${item.specificationId}`} value={`${item.board}:${item.specificationId}`}>
              {EXAM_BOARD_LABELS[item.board]} · {item.specificationTitle}
            </option>
          ))}
        </Select>
        <Select
          label="Back to"
          value={String(fromYear)}
          containerClassName="sm:w-40"
          onChange={(event) => setFromYear(Number(event.target.value))}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
      </div>

      {target ? (
        <p className="mt-3 text-sm text-text-secondary">
          {target.components.length} component{target.components.length === 1 ? "" : "s"} ×{" "}
          {years.filter((year) => year >= fromYear).length} year
          {years.filter((year) => year >= fromYear).length === 1 ? "" : "s"} — up to{" "}
          {target.components.length * years.filter((year) => year >= fromYear).length} papers, about $
          {(target.components.length * years.filter((year) => year >= fromYear).length * COST_PER_PAPER_USD).toFixed(2)}{" "}
          to read.
          {patterned ? "" : " This board has no derivable paper addresses, so nothing will be found automatically."}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={seeding} onClick={() => void seed()}>
          {seeding ? "Seeding…" : "Seed the catalogue"}
        </Button>
        <Button variant="secondary" disabled={running || !patterned} onClick={() => void run(true)}>
          Dry run
        </Button>
        <Button disabled={running || !patterned} onClick={() => void run(false)}>
          {running ? "Running…" : "Ingest this course"}
        </Button>
      </div>

      {seeded ? <p className="mt-3 text-sm text-success">{seeded}</p> : null}

      {batch ? (
        <div className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <p className="text-sm font-medium text-text-primary">
            {batch.papersFound} paper{batch.papersFound === 1 ? "" : "s"} found
            {batch.papersWithoutSources > 0
              ? ` · ${batch.papersWithoutSources} component${batch.papersWithoutSources === 1 ? "" : "s"} had none`
              : ""}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {batch.done} done · {batch.failed} stopped · {batch.published} questions clean ·{" "}
            {batch.needsReview} to review
          </p>
          {current ? <p className="mt-2 text-xs text-text-muted">{current}…</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
