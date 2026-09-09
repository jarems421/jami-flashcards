"use client";

import { useCallback, useEffect, useState } from "react";
import { auth } from "@/services/firebase/client";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  Select,
  Skeleton,
  StudyText,
} from "@/components/ui";
import { EXAM_BOARD_LABELS, type ExamBoardId } from "@/lib/practice/exam-formats";
import type { ExamPaperManifestDraft } from "@/lib/practice/exam-ingestion-manifest";
import type { ExamQuestionReviewItem } from "@/services/practice/exam-corpus-review.server";

/** Only the boards whose licence is recorded can be ingested under. */
const LICENSED_BOARDS: ExamBoardId[] = [
  "aqa",
  "pearson_edexcel",
  "ocr",
  "wjec",
  "eduqas",
  "ccea",
  "qualifications_scotland",
];

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
  if (!response.ok) {
    const code = typeof data?.error === "string" ? data.error : "request_failed";
    throw new Error(
      code === "reviewer_not_configured"
        ? "PAPER_QUALITY_REVIEWER_UIDS is not set in this environment."
        : code === "forbidden"
          ? "This account is not on the reviewer list."
          : code === "course_not_in_catalogue"
            ? "That specification is not in the current course catalogue yet."
            : code
    );
  }
  return data ?? {};
}

type IngestOutcome = { published: number; needsReview: number; paperId: string };

/**
 * The owner's side of the question bank.
 *
 * Two jobs that belong together: getting papers in, and deciding whether what
 * came out of them is right. Neither is a student surface and neither is
 * reachable without being on the reviewer list.
 */
export default function ExamCorpusWorkspace() {
  const [board, setBoard] = useState<ExamBoardId>("aqa");
  const [specificationId, setSpecificationId] = useState("");
  const [manifests, setManifests] = useState<ExamPaperManifestDraft[] | null>(null);
  const [discarded, setDiscarded] = useState(0);
  const [finding, setFinding] = useState(false);
  const [ingesting, setIngesting] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, IngestOutcome | string>>({});
  const [pending, setPending] = useState<ExamQuestionReviewItem[] | null>(null);
  const [deciding, setDeciding] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPending = useCallback(async () => {
    try {
      const data = await internalRequest("/api/internal/exam-questions/review");
      setPending(data.questions as ExamQuestionReviewItem[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The review queue could not be loaded.");
      setPending([]);
    }
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const find = async () => {
    setFinding(true);
    setError("");
    setManifests(null);
    try {
      const data = await internalRequest("/api/internal/exam-questions/discover", {
        method: "POST",
        body: JSON.stringify({ board, specificationId }),
      });
      setManifests(data.manifests as ExamPaperManifestDraft[]);
      setDiscarded(typeof data.discarded === "number" ? data.discarded : 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Papers could not be found.");
    } finally {
      setFinding(false);
    }
  };

  const ingest = async (manifest: ExamPaperManifestDraft, dryRun: boolean) => {
    const key = manifest.questionPaperUrl;
    setIngesting(key);
    setError("");
    try {
      const data = await internalRequest("/api/internal/exam-questions/ingest", {
        method: "POST",
        body: JSON.stringify({ manifest, dryRun }),
      });
      setOutcomes((current) => ({
        ...current,
        [key]: {
          paperId: String(data.paperId ?? ""),
          published: Number(data.published ?? 0),
          needsReview: Number(data.needsReview ?? 0),
        },
      }));
      if (!dryRun) await loadPending();
    } catch (reason) {
      setOutcomes((current) => ({
        ...current,
        [key]: reason instanceof Error ? reason.message : "Ingestion failed.",
      }));
    } finally {
      setIngesting("");
    }
  };

  const decide = async (questionId: string, decision: "accept" | "reject") => {
    setDeciding(questionId);
    setError("");
    try {
      await internalRequest("/api/internal/exam-questions/review", {
        method: "POST",
        body: JSON.stringify({ questionId, decision }),
      });
      setPending((current) => current?.filter((item) => item.id !== questionId) ?? current);
      setNotice(decision === "accept" ? "Question approved and published." : "Question withdrawn.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That decision could not be saved.");
    } finally {
      setDeciding("");
    }
  };

  return (
    <div className="space-y-6">
      {error ? <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} /> : null}
      {notice ? <FeedbackBanner type="success" message={notice} onDismiss={() => setNotice("")} /> : null}

      <Card padding="lg">
        <h2 className="text-lg font-semibold text-text-primary">Find papers for a course</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
          Reads the board&apos;s own past-paper pages and pairs each question paper with its mark
          scheme. Nothing is downloaded or written until you ingest a specific paper. A dry run
          reports what it extracted without storing anything.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Select
            label="Board"
            value={board}
            containerClassName="sm:w-64"
            onChange={(event) => setBoard(event.target.value as ExamBoardId)}
          >
            {LICENSED_BOARDS.map((id) => (
              <option key={id} value={id}>
                {EXAM_BOARD_LABELS[id]}
              </option>
            ))}
          </Select>
          <Input
            label="Specification code"
            value={specificationId}
            placeholder="8461"
            containerClassName="sm:w-56"
            onChange={(event) => setSpecificationId(event.target.value)}
          />
          <Button disabled={!specificationId.trim() || finding} onClick={() => void find()}>
            {finding ? "Searching…" : "Find papers"}
          </Button>
        </div>

        {manifests ? (
          manifests.length === 0 ? (
            <p className="mt-5 text-sm text-text-muted">
              No paper and mark-scheme pairs were found for that specification
              {discarded > 0 ? ` (${discarded} pairs named no sitting and were skipped)` : ""}.
            </p>
          ) : (
            <div className="mt-5 space-y-2">
              <p className="text-sm text-text-muted">
                {manifests.length} paper{manifests.length === 1 ? "" : "s"} ready
                {discarded > 0 ? ` · ${discarded} skipped for naming no sitting` : ""}
              </p>
              {manifests.map((manifest) => {
                const outcome = outcomes[manifest.questionPaperUrl];
                const busy = ingesting === manifest.questionPaperUrl;
                return (
                  <div
                    key={manifest.questionPaperUrl}
                    className="rounded-2xl border border-[var(--color-border)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary">
                          {manifest.series} {manifest.year} · {manifest.paperReference}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-text-muted">
                          {manifest.subject} · {manifest.componentTitle || manifest.componentCode}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void ingest(manifest, true)}
                        >
                          Dry run
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void ingest(manifest, false)}
                        >
                          {busy ? "Reading…" : "Ingest"}
                        </Button>
                      </div>
                    </div>
                    {outcome ? (
                      <p className="mt-2 text-xs text-text-secondary">
                        {typeof outcome === "string"
                          ? outcome
                          : `${outcome.published} extracted cleanly · ${outcome.needsReview} flagged`}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </Card>

      <div>
        <h2 className="text-lg font-semibold text-text-primary">Questions waiting on you</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
          A licence makes a question lawful to serve. It does not make the extraction of it right,
          and a mispaired mark scheme marks a student wrongly. Nothing here reaches a student until
          it is approved.
        </p>

        {pending === null ? (
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : pending.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              emoji="✅"
              title="Nothing waiting"
              description="Every ingested question has been reviewed. Ingest a paper above to add more."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {pending.map((item) => (
              <Card key={item.id} padding="lg">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-text-muted">
                    {item.provenance.boardLabel} · {item.provenance.series} {item.provenance.year} ·{" "}
                    {item.provenance.paperReference} · Q{item.provenance.questionNumber}
                  </p>
                  <span className="text-xs font-medium text-text-muted">
                    {item.marks} mark{item.marks === 1 ? "" : "s"} · {item.difficulty}
                  </span>
                </div>

                {item.verification && item.verification.issues.length > 0 ? (
                  <ul className="mt-3 space-y-1 rounded-2xl border border-error/30 bg-error/10 p-3">
                    {item.verification.issues.map((issue, index) => (
                      <li key={index} className="text-sm text-text-primary">
                        · {issue}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text-secondary">Question</h3>
                    <StudyText
                      as="div"
                      text={item.prompt}
                      className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text-secondary">
                      Paired scheme · {item.markScheme.regime}
                    </h3>
                    {item.markScheme.criteria.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {item.markScheme.criteria.map((criterion) => (
                          <li key={criterion.id} className="text-sm leading-5 text-text-primary">
                            <span className="text-text-muted">[{criterion.marks}]</span>{" "}
                            {criterion.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-text-muted">
                        No awardable criteria were parsed. Reject unless the regime explains it.
                      </p>
                    )}
                    {item.markScheme.officialText ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-text-secondary">
                          Scheme text as extracted
                        </summary>
                        <StudyText
                          as="div"
                          text={item.markScheme.officialText}
                          className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted"
                        />
                      </details>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={deciding === item.id}
                    onClick={() => void decide(item.id, "accept")}
                  >
                    {deciding === item.id ? "Saving…" : "Approve and publish"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deciding === item.id}
                    onClick={() => void decide(item.id, "reject")}
                  >
                    Withdraw
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
