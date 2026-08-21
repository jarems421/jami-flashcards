"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button, Card, EmptyState, Input, ProgressBar, SectionHeader, Select, Skeleton, Textarea,
} from "@/components/ui";
import type { ExamFormatProfile } from "@/lib/practice/exam-formats";
import {
  PAPER_GENERATION_BENCHMARK_DEFINITIONS,
  type PaperGenerationBenchmarkBlocker,
  type PaperGenerationBenchmarkCase,
  type PaperGenerationBenchmarkReviewScores,
  type PaperGenerationBenchmarkRun,
} from "@/lib/practice/paper-generation-benchmark";
import {
  cancelPaperBenchmark,
  getPaperBenchmarkAsset,
  getPaperBenchmarkArtifact,
  getPaperBenchmarkRun,
  getPaperQualityOverview,
  importExamFormatFile,
  importExamFormatUrl,
  refreshExamFormatProfile,
  savePaperBenchmarkReview,
  startPaperBenchmark,
  updatePaperBenchmarkRun,
  type PaperBenchmarkReadiness,
} from "@/services/ai/paper-quality";

const SCORE_FIELDS: Array<{ key: keyof PaperGenerationBenchmarkReviewScores; label: string }> = [
  { key: "authenticity", label: "Exam authenticity" },
  { key: "levelFit", label: "Level and difficulty" },
  { key: "schemeCorrectness", label: "Mark-scheme correctness" },
  { key: "specificationCoverage", label: "Specification coverage" },
  { key: "timing", label: "Timing realism" },
  { key: "visualQuality", label: "Figures and inserts" },
  { key: "accessibility", label: "Clarity and accessibility" },
  { key: "originality", label: "Originality" },
];
const BLOCKERS: Array<{ key: PaperGenerationBenchmarkBlocker; label: string }> = [
  { key: "unanswerable_question", label: "Unanswerable question" },
  { key: "incorrect_scheme", label: "Incorrect mark scheme" },
  { key: "invalid_total", label: "Invalid marks or totals" },
  { key: "answer_leak", label: "Answer leaked to candidate" },
  { key: "missing_insert", label: "Required insert missing" },
  { key: "broken_visual", label: "Broken or misleading visual" },
  { key: "confirmed_copying", label: "Confirmed copied question" },
  { key: "privacy_failure", label: "Privacy failure" },
  { key: "ownership_failure", label: "Ownership failure" },
];

type Overview = {
  profiles: ExamFormatProfile[];
  readiness: PaperBenchmarkReadiness;
  runs: PaperGenerationBenchmarkRun[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function PrivateBenchmarkImage({ asset }: { asset: Record<string, unknown> }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    const previewUrl = typeof asset.previewUrl === "string" ? asset.previewUrl : "";
    if (!previewUrl) return;
    let active = true;
    let objectUrl = "";
    void getPaperBenchmarkAsset(previewUrl).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.previewUrl]);
  if (!source) return <Skeleton className="mt-3 aspect-[4/3] w-full max-w-xl rounded-xl" />;
  return (
    <Image
      unoptimized
      src={source}
      width={typeof asset.width === "number" ? asset.width : 1024}
      height={typeof asset.height === "number" ? asset.height : 768}
      alt={typeof asset.altText === "string" ? asset.altText : "Question figure"}
      className="mt-3 h-auto w-full max-w-xl rounded-xl border border-[var(--color-border)]"
    />
  );
}

function ArtifactPreview({ artifact }: { artifact: Record<string, unknown> }) {
  const profile = asRecord(artifact.profile);
  const receipts = Array.isArray(profile.sources) ? profile.sources.map(asRecord) : [];
  const paper = asRecord(artifact.paper);
  const questions = Array.isArray(paper.questions) ? paper.questions.map(asRecord) : [];
  const scheme = asRecord(paper.markScheme);
  const items = Array.isArray(scheme.items) ? scheme.items.map(asRecord) : [];
  const companions = Array.isArray(paper.companionDocuments) ? paper.companionDocuments.map(asRecord) : [];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Frozen official profile</p>
        <p className="mt-2 text-sm font-semibold text-text-primary">
          {String(profile.boardLabel ?? "Board")} · {String(profile.specificationCode ?? "Specification")} · {String(profile.componentCode ?? "Component")}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Version {String(profile.version ?? "—")} · {String(profile.verificationStatus ?? "unverified")} · {receipts.length} source receipts
        </p>
        {receipts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {receipts.map((receipt, index) => (
              <a
                key={String(receipt.id ?? index)}
                href={String(receipt.url ?? "#")}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-text-secondary hover:text-accent"
              >{String(receipt.documentType ?? "official source").replaceAll("_", " ")}</a>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid min-h-0 gap-4 xl:grid-cols-2">
      <article className="min-h-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 xl:max-h-[68vh] xl:overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Candidate paper</p>
        <h3 className="mt-2 text-xl font-semibold text-text-primary">{String(paper.title ?? "Generated paper")}</h3>
        <p className="mt-1 text-sm text-text-muted">{String(paper.durationMinutes ?? "—")} minutes · {String(paper.totalMarks ?? "—")} marks</p>
        {companions.length > 0 ? (
          <div className="mt-4 rounded-xl border border-accent/20 bg-accent/8 p-3 text-sm text-text-secondary">
            Companion material: {companions.map((item) => String(item.title ?? "Insert")).join(", ")}
          </div>
        ) : null}
        <ol className="mt-5 space-y-5">
          {questions.map((question, index) => (
            <li key={String(question.id ?? index)}>
              <div className="flex items-start justify-between gap-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{String(question.prompt ?? "")}</p>
                <span className="shrink-0 rounded-lg bg-[var(--color-glass-subtle)] px-2 py-1 text-xs font-semibold text-text-muted">[{String(question.marks ?? "—")}]</span>
              </div>
              {Array.isArray(question.assets)
                ? question.assets.map(asRecord).map((asset, assetIndex) =>
                    typeof asset.previewUrl === "string"
                      ? <PrivateBenchmarkImage key={String(asset.id ?? assetIndex)} asset={asset} />
                      : asset.content
                        ? <pre key={String(asset.id ?? assetIndex)} className="mt-3 overflow-x-auto rounded-xl bg-[var(--color-glass-subtle)] p-3 text-xs text-text-secondary">{String(asset.content)}</pre>
                        : null
                  )
                : null}
            </li>
          ))}
        </ol>
        {companions.map((companion, index) => (
          <section key={String(companion.id ?? index)} className="mt-6 border-t border-[var(--color-border)] pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Companion document</p>
            <h4 className="mt-2 text-base font-semibold text-text-primary">{String(companion.title ?? "Candidate insert")}</h4>
            {Array.isArray(companion.pages) ? companion.pages.map(asRecord).map((page, pageIndex) => (
              <div key={String(page.id ?? pageIndex)} className="mt-3 rounded-xl bg-[var(--color-glass-subtle)] p-4">
                {page.title ? <p className="mb-2 text-sm font-semibold text-text-primary">{String(page.title)}</p> : null}
                <p className="whitespace-pre-wrap text-sm leading-6 text-text-secondary">{String(page.content ?? "")}</p>
              </div>
            )) : null}
          </section>
        ))}
      </article>
      <article className="min-h-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-5 xl:max-h-[68vh] xl:overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-warning-text)]">Hidden marking guide</p>
        <div className="mt-5 space-y-5">
          {items.map((item, index) => (
            <section key={String(item.questionId ?? index)} className="rounded-xl bg-[var(--color-surface)] p-4">
              <h4 className="text-sm font-semibold text-text-primary">{String(item.questionId ?? `Question ${index + 1}`)} · {String(item.maxMarks ?? "—")} marks</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{String(item.answer ?? "No answer supplied")}</p>
            </section>
          ))}
        </div>
      </article>
      </div>
    </div>
  );
}

function ReviewForm({
  existing,
  disabled,
  onSave,
}: {
  existing?: PaperGenerationBenchmarkCase["review"];
  disabled?: boolean;
  onSave: (value: Record<string, unknown>) => void;
}) {
  const [scores, setScores] = useState<PaperGenerationBenchmarkReviewScores>(() =>
    existing?.scores ?? Object.fromEntries(SCORE_FIELDS.map(({ key }) => [key, 3])) as PaperGenerationBenchmarkReviewScores
  );
  const [blockers, setBlockers] = useState<PaperGenerationBenchmarkBlocker[]>(existing?.blockers ?? []);
  const [comments, setComments] = useState(existing?.comments ?? "");
  const [usable, setUsable] = useState(existing?.usable ?? true);
  return (
    <Card padding="lg" className="space-y-5">
      <SectionHeader eyebrow="Human review" title="Is this a dependable complete sitting?" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SCORE_FIELDS.map((field) => (
          <Select
            key={field.key}
            label={field.label}
            value={scores[field.key]}
            disabled={disabled}
            onChange={(event) => setScores((current) => ({ ...current, [field.key]: Number(event.target.value) }))}
          >
            {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}
          </Select>
        ))}
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-text-primary">Hard blockers</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BLOCKERS.map((blocker) => (
            <label key={blocker.key} className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={blockers.includes(blocker.key)}
                disabled={disabled}
                onChange={(event) => {
                  setBlockers((current) => event.target.checked ? [...current, blocker.key] : current.filter((item) => item !== blocker.key));
                  if (event.target.checked) setUsable(false);
                }}
              />
              {blocker.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Textarea label="Review notes" rows={3} value={comments} disabled={disabled} onChange={(event) => setComments(event.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <input type="checkbox" checked={usable} disabled={disabled || blockers.length > 0} onChange={(event) => setUsable(event.target.checked)} />
          Paper is usable
        </label>
        <Button type="button" disabled={disabled} onClick={() => onSave({ usable, scores, blockers, comments })}>
          Save review
        </Button>
      </div>
    </Card>
  );
}

export default function PaperQualityWorkspace() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedRun, setSelectedRun] = useState<PaperGenerationBenchmarkRun | null>(null);
  const [cases, setCases] = useState<PaperGenerationBenchmarkCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<PaperGenerationBenchmarkCase | null>(null);
  const [artifact, setArtifact] = useState<Record<string, unknown> | null>(null);
  const [spendCeiling, setSpendCeiling] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const selectedRunId = selectedRun?.id;
  const selectedRunStatus = selectedRun?.status;

  const load = useCallback(async () => {
    try {
      const value = await getPaperQualityOverview();
      setOverview(value);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Paper quality tools are unavailable.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedRunId) return;
    let active = true;
    const refresh = async () => {
      try {
        const detail = await getPaperBenchmarkRun(selectedRunId);
        if (!active) return;
        setSelectedRun(detail.run);
        setCases(detail.cases);
      } catch { /* The top-level error remains more useful than poll noise. */ }
    };
    void refresh();
    const timer = selectedRunStatus === "queued" || selectedRunStatus === "running"
      ? setInterval(() => void refresh(), 8_000) : undefined;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [selectedRunId, selectedRunStatus]);

  const openCase = async (item: PaperGenerationBenchmarkCase) => {
    if (!selectedRun || item.status !== "ready") return;
    setSelectedCase(item);
    setArtifact(null);
    setBusy(`case:${item.id}`);
    try { setArtifact(await getPaperBenchmarkArtifact(selectedRun.id, item.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open that paper."); }
    finally { setBusy(""); }
  };

  const missingDefinitions = useMemo(() => new Set(overview?.readiness.missingProfiles ?? []), [overview]);
  if (!overview && !error) return <Skeleton className="h-[34rem] rounded-3xl" />;
  if (error && !overview) return <EmptyState title="Paper quality tools are locked" description={error} />;
  if (!overview) return null;

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger)]/8 p-3 text-sm text-[var(--color-danger-text)]">{error}</div> : null}
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card padding="lg" className="space-y-5">
          <SectionHeader eyebrow="Format library" title="Official component profiles" />
          <p className="text-sm leading-6 text-text-muted">Profiles are researched and versioned automatically. Refreshing an uncertain component never requires manual approval.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PAPER_GENERATION_BENCHMARK_DEFINITIONS.map((definition) => {
              const profile = overview.profiles.find((item) => item.id === definition.profileId);
              const missing = missingDefinitions.has(definition.id);
              return (
                <div key={definition.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{definition.subject} · {definition.componentLabel}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{profile ? `${profile.specificationCode} · ${profile.activeVersion}` : "Not built yet"}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={missing ? "secondary" : "ghost"}
                    disabled={Boolean(busy)}
                    onClick={async () => {
                      setBusy(`profile:${definition.profileId}`);
                      try { await refreshExamFormatProfile(definition.profileId); await load(); }
                      catch (caught) { setError(caught instanceof Error ? caught.message : "Refresh failed."); }
                      finally { setBusy(""); }
                    }}
                  >
                    {busy === `profile:${definition.profileId}` ? "Checking…" : profile ? "Refresh" : "Build"}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card padding="lg" className="space-y-5">
          <SectionHeader eyebrow="Fallback import" title="Add official evidence" />
          <Input label="Official exam-board URL" value={importUrl} placeholder="https://…" onChange={(event) => setImportUrl(event.target.value)} />
          <Button
            type="button"
            variant="secondary"
            disabled={Boolean(busy) || !importUrl.trim()}
            onClick={async () => {
              setBusy("url-import");
              try { await importExamFormatUrl(importUrl.trim()); setImportUrl(""); }
              catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed."); }
              finally { setBusy(""); }
            }}
          >
            Queue URL
          </Button>
          <label className="block rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4 text-sm text-text-secondary">
            <span className="font-semibold text-text-primary">PDF, CSV or JSON manifest</span>
            <input
              className="mt-3 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-accent/10 file:px-3 file:py-2 file:font-semibold file:text-accent"
              type="file"
              accept="application/pdf,text/csv,application/json,text/plain,.pdf,.csv,.json"
              disabled={Boolean(busy)}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setBusy("file-import");
                try { await importExamFormatFile(file); }
                catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed."); }
                finally { setBusy(""); event.target.value = ""; }
              }}
            />
          </label>
        </Card>
      </div>

      <Card padding="lg" className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader eyebrow="Measured quality" title="108-paper generation benchmark" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              label={`Confirmed spend ceiling · projected ${overview.readiness.projectedCostUsd === null ? "unavailable" : `$${overview.readiness.projectedCostUsd.toFixed(2)}`}`}
              inputMode="decimal"
              value={spendCeiling}
              placeholder="USD"
              onChange={(event) => setSpendCeiling(event.target.value)}
            />
            <Button
              type="button"
              disabled={!overview.readiness.ready || Boolean(busy) || !(Number(spendCeiling) >= (overview.readiness.projectedCostUsd ?? Infinity))}
              onClick={async () => {
                setBusy("start");
                try { await startPaperBenchmark(Number(spendCeiling)); await load(); }
                catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start benchmark."); }
                finally { setBusy(""); }
              }}
            >
              Start reviewed batch
            </Button>
          </div>
        </div>
        {!overview.readiness.ready ? (
          <p className="rounded-xl border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/8 p-3 text-sm text-[var(--color-warning-text)]">
            Build all 12 verified profiles and configure the measured per-case cost estimate before starting.
          </p>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
          {overview.runs.length === 0 ? (
            <p className="text-sm text-text-muted">No benchmark batches yet.</p>
          ) : overview.runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-left transition hover:border-accent/35"
              onClick={() => setSelectedRun(run)}
            >
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{run.status.replaceAll("_", " ")}</span>
              <span className="mt-2 block text-sm font-semibold text-text-primary">{run.completedCases}/{run.expectedCases} generated</span>
              <span className="mt-1 block text-xs text-text-muted">{run.reviewedCases} reviewed · ${run.estimatedCostUsd.toFixed(2)}</span>
            </button>
          ))}
        </div>
      </Card>

      {selectedRun ? (
        <Card padding="lg" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader eyebrow="Review batch" title={`${selectedRun.reviewedCases}/${selectedRun.expectedCases} papers reviewed`} />
            <div className="flex gap-2">
              {selectedRun.status === "awaiting_review" ? (
                <Button
                  type="button"
                  disabled={selectedRun.passedCases !== selectedRun.expectedCases || Boolean(busy)}
                  onClick={async () => {
                    setBusy("approve");
                    try {
                      const approved = await updatePaperBenchmarkRun(selectedRun.id, "approve");
                      if (approved.baseline) {
                        const url = URL.createObjectURL(new Blob(
                          [JSON.stringify(approved.baseline, null, 2)],
                          { type: "application/json" }
                        ));
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = "paper-generation-baselines.json";
                        anchor.click();
                        URL.revokeObjectURL(url);
                      }
                      await load();
                    }
                    catch (caught) { setError(caught instanceof Error ? caught.message : "Approval failed."); }
                    finally { setBusy(""); }
                  }}
                >Approve baseline</Button>
              ) : null}
              {(selectedRun.status === "queued" || selectedRun.status === "running" || selectedRun.status === "paused") ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    setBusy("cancel");
                    try {
                      await cancelPaperBenchmark(selectedRun.id);
                      const detail = await getPaperBenchmarkRun(selectedRun.id);
                      setSelectedRun(detail.run);
                      setCases(detail.cases);
                      await load();
                    }
                    catch (caught) { setError(caught instanceof Error ? caught.message : "Cancellation failed."); }
                    finally { setBusy(""); }
                  }}
                >Cancel</Button>
              ) : null}
            </div>
          </div>
          {(selectedRun.status === "paused" || selectedRun.status === "failed" || selectedRun.status === "cancelled") ? (
            <div className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Input
                label="New hard ceiling (USD)"
                inputMode="decimal"
                value={spendCeiling}
                placeholder={`More than $${selectedRun.estimatedCostUsd.toFixed(2)}`}
                onChange={(event) => setSpendCeiling(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(busy) || !(Number(spendCeiling) > selectedRun.estimatedCostUsd)}
                onClick={async () => {
                  setBusy("resume");
                  try {
                    await updatePaperBenchmarkRun(selectedRun.id, "resume", Number(spendCeiling));
                    setSpendCeiling("");
                    const detail = await getPaperBenchmarkRun(selectedRun.id);
                    setSelectedRun(detail.run);
                    setCases(detail.cases);
                  } catch (caught) { setError(caught instanceof Error ? caught.message : "Resume failed."); }
                  finally { setBusy(""); }
                }}
              >Resume batch</Button>
            </div>
          ) : null}
          <ProgressBar progress={selectedRun.expectedCases ? (selectedRun.completedCases / selectedRun.expectedCases) * 100 : 0} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cases.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.status !== "ready"}
                className="rounded-xl border border-[var(--color-border)] p-3 text-left disabled:opacity-55"
                onClick={() => void openCase(item)}
              >
                <span className="block truncate text-sm font-semibold text-text-primary">{item.definitionId}</span>
                <span className="mt-1 block text-xs text-text-muted">{item.kind.replaceAll("_", " ")} · run {item.repetition} · {item.review ? "reviewed" : item.status}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {selectedCase ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-sm text-text-muted md:hidden">
            Detailed paper comparison works best on iPad or desktop.
          </div>
          <div className="hidden md:block">
            {artifact ? <ArtifactPreview artifact={artifact} /> : <Skeleton className="h-[32rem] rounded-2xl" />}
          </div>
          <div className="hidden md:block">
            <ReviewForm
              key={`${selectedCase.id}-${selectedCase.review?.reviewedAt ?? 0}`}
              existing={selectedCase.review}
              disabled={Boolean(busy) || !artifact}
              onSave={async (review) => {
                if (!selectedRun) return;
                setBusy("review");
                try {
                  await savePaperBenchmarkReview(selectedRun.id, selectedCase.id, review);
                  const detail = await getPaperBenchmarkRun(selectedRun.id);
                  setSelectedRun(detail.run);
                  setCases(detail.cases);
                  setSelectedCase(detail.cases.find((item) => item.id === selectedCase.id) ?? null);
                } catch (caught) { setError(caught instanceof Error ? caught.message : "Review could not be saved."); }
                finally { setBusy(""); }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
