import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { AiResponseDiagnostics } from "@/lib/ai/provider-router";
import type { Source } from "@/lib/material/sources";
import type { GeneratedPracticePaper, PracticePaperGenerationResponse } from "@/lib/practice/practice-papers";
import { practicePaperFormatContext } from "@/lib/practice/exam-formats";
import {
  PAPER_GENERATION_BENCHMARK_DEFINITIONS,
  PAPER_GENERATION_BENCHMARK_VERSION,
  buildPaperGenerationBenchmarkCaseId,
  expectedPaperGenerationBenchmarkCases,
  paperGenerationBenchmarkCaseSpecs,
  type PaperGenerationBenchmarkBlocker,
  type PaperGenerationBenchmarkCase,
  type PaperGenerationBenchmarkCaseKind,
  type PaperGenerationBenchmarkReport,
  type PaperGenerationBenchmarkReview,
  type PaperGenerationBenchmarkReviewScores,
  type PaperGenerationBenchmarkRun,
  type PaperGenerationBenchmarkRunKind,
} from "@/lib/practice/paper-generation-benchmark";
import { getExamFormatProfileVersion } from "@/services/ai/exam-format-library.server";
import { runPracticePaperGenerationForBenchmark } from "@/services/ai/practice-paper-generation.server";
import { createPaperRasterAssets } from "@/services/ai/practice-paper-workflow.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

const HARD_BLOCKERS: PaperGenerationBenchmarkBlocker[] = [
  "unanswerable_question", "incorrect_scheme", "invalid_total", "answer_leak",
  "missing_insert", "broken_visual", "confirmed_copying", "privacy_failure",
  "ownership_failure",
];
const SCORE_KEYS: Array<keyof PaperGenerationBenchmarkReviewScores> = [
  "authenticity", "levelFit", "schemeCorrectness", "specificationCoverage",
  "timing", "visualQuality", "accessibility", "originality",
];

function enabled() {
  return process.env.PAPER_GENERATION_BENCHMARK_ENABLED === "true";
}

function caseEstimate() {
  const value = Number.parseFloat(process.env.PAPER_BENCHMARK_CASE_COST_ESTIMATE_USD ?? "");
  return Number.isFinite(value) && value > 0 ? Math.round(value * 10_000) / 10_000 : null;
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function runRef(runId: string) {
  return getAdminDb().collection("paperGenerationBenchmarkRuns").doc(runId);
}

function caseRef(runId: string, caseId: string) {
  return runRef(runId).collection("cases").doc(caseId);
}

function safeRun(id: string, value: Record<string, unknown>): PaperGenerationBenchmarkRun {
  return {
    id,
    kind: value.kind === "pilot" ? "pilot" : "baseline",
    definitionVersion: typeof value.definitionVersion === "string" ? value.definitionVersion : "",
    status: value.status as PaperGenerationBenchmarkRun["status"],
    expectedCases: typeof value.expectedCases === "number" ? value.expectedCases : 0,
    completedCases: typeof value.completedCases === "number" ? value.completedCases : 0,
    reviewedCases: typeof value.reviewedCases === "number" ? value.reviewedCases : 0,
    passedCases: typeof value.passedCases === "number" ? value.passedCases : 0,
    projectedCostUsd: typeof value.projectedCostUsd === "number" ? value.projectedCostUsd : 0,
    spendCeilingUsd: typeof value.spendCeilingUsd === "number" ? value.spendCeilingUsd : 0,
    estimatedCostUsd: typeof value.estimatedCostUsd === "number" ? value.estimatedCostUsd : 0,
    cancellationRequested: value.cancellationRequested === true,
    createdBy: typeof value.createdBy === "string" ? value.createdBy : "",
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    approvedAt: typeof value.approvedAt === "number" ? value.approvedAt : undefined,
  };
}

export async function getPaperBenchmarkReadiness() {
  const estimate = caseEstimate();
  const profiles = await Promise.all(PAPER_GENERATION_BENCHMARK_DEFINITIONS.map(async (definition) => ({
    definition,
    profile: await getExamFormatProfileVersion(definition.profileId),
  })));
  const missingProfiles = profiles
    .filter((item) => !item.profile || item.profile.verificationStatus !== "verified")
    .map((item) => item.definition.id);
  return {
    enabled: enabled(),
    definitionVersion: PAPER_GENERATION_BENCHMARK_VERSION,
    expectedCases: expectedPaperGenerationBenchmarkCases(),
    caseCostEstimateUsd: estimate,
    projectedCostUsd: estimate === null ? null : Math.round(estimate * expectedPaperGenerationBenchmarkCases() * 100) / 100,
    pilotExpectedCases: PAPER_GENERATION_BENCHMARK_DEFINITIONS.length,
    pilotProjectedCostUsd: estimate === null
      ? null
      : Math.round(estimate * PAPER_GENERATION_BENCHMARK_DEFINITIONS.length * 100) / 100,
    missingProfiles,
    ready: enabled() && estimate !== null && missingProfiles.length === 0,
  };
}

export async function createPaperGenerationBenchmarkRun(input: {
  reviewerUid: string;
  spendCeilingUsd: number;
  kind?: PaperGenerationBenchmarkRunKind;
}) {
  const readiness = await getPaperBenchmarkReadiness();
  const kind = input.kind === "pilot" ? "pilot" : "baseline";
  const caseSpecs = paperGenerationBenchmarkCaseSpecs(kind);
  const projectedCostUsd = readiness.caseCostEstimateUsd === null
    ? null
    : Math.round(readiness.caseCostEstimateUsd * caseSpecs.length * 100) / 100;
  if (!readiness.enabled) throw new Error("Paper-generation benchmarks are disabled.");
  if (projectedCostUsd === null) throw new Error("Configure the measured per-case cost estimate first.");
  if (readiness.missingProfiles.length > 0) {
    throw new Error(`Build and verify the benchmark profiles first: ${readiness.missingProfiles.join(", ")}`);
  }
  if (!Number.isFinite(input.spendCeilingUsd) || input.spendCeilingUsd < projectedCostUsd) {
    throw new Error(`The spend ceiling must cover the projected $${projectedCostUsd.toFixed(2)} batch cost.`);
  }
  const now = Date.now();
  const ref = getAdminDb().collection("paperGenerationBenchmarkRuns").doc(randomUUID());
  const run: Omit<PaperGenerationBenchmarkRun, "id"> = {
    kind,
    definitionVersion: PAPER_GENERATION_BENCHMARK_VERSION,
    status: "queued",
    expectedCases: caseSpecs.length,
    completedCases: 0,
    reviewedCases: 0,
    passedCases: 0,
    projectedCostUsd,
    spendCeilingUsd: Math.round(input.spendCeilingUsd * 100) / 100,
    estimatedCostUsd: 0,
    cancellationRequested: false,
    createdBy: input.reviewerUid,
    createdAt: now,
    updatedAt: now,
  };
  const db = getAdminDb();
  const batch = db.batch();
  batch.create(ref, run);
  for (const definition of PAPER_GENERATION_BENCHMARK_DEFINITIONS) {
    const profile = await getExamFormatProfileVersion(definition.profileId);
    if (!profile) throw new Error(`Profile ${definition.profileId} disappeared before the run was created.`);
    for (const spec of caseSpecs.filter((candidate) => candidate.definition.id === definition.id)) {
        const id = buildPaperGenerationBenchmarkCaseId(definition.id, spec.kind, spec.repetition);
        const item: Omit<PaperGenerationBenchmarkCase, "id"> = {
          runId: ref.id,
          definitionId: definition.id,
          profileId: definition.profileId,
          profileVersion: profile.version,
          kind: spec.kind,
          repetition: spec.repetition,
          status: "queued",
          estimatedCostUsd: 0,
          createdAt: now,
          updatedAt: now,
        };
        batch.create(ref.collection("cases").doc(id), item);
    }
  }
  await batch.commit();
  return { ...run, id: ref.id };
}

function syntheticSource(input: {
  caseId: string;
  kind: PaperGenerationBenchmarkCaseKind;
  subject: string;
  qualification: string;
  topicExpectations: string[];
  assessmentObjectives: string[];
}) {
  const coverage = input.topicExpectations.slice(0, 12);
  const objectives = input.assessmentObjectives.slice(0, 12);
  const additions = input.kind === "synthetic_folder"
    ? "Synthetic class notes stress accurate definitions, worked application, common misconceptions, and clear evaluation."
    : input.kind === "complete_with_emphasis"
      ? `Give modest extra emphasis to ${coverage.slice(0, 2).join(" and ") || "the first two specification areas"}, while retaining complete specification coverage and authentic weighting.`
      : "Follow the complete official component without a topic-only emphasis.";
  const now = Date.now();
  const source: Source = {
    id: `benchmark-${input.caseId}`,
    title: "Synthetic benchmark course pack",
    type: "manual_note",
    subject: input.subject,
    folderIds: ["benchmark-folder"],
    topicIds: [],
    contentText: [
      `Course: ${input.qualification} ${input.subject}.`,
      coverage.length ? `Specification coverage: ${coverage.join("; ")}.` : "Cover the complete specification component.",
      objectives.length ? `Assessment objectives: ${objectives.join("; ")}.` : "Use the official assessment objectives.",
      additions,
      "This is deliberately created benchmark material and contains no student information.",
    ].join("\n\n"),
    status: "active",
    createdBy: "paper-generation-benchmark",
    createdAt: now,
    updatedAt: now,
  };
  return source;
}

function actualCost(diagnostics: AiResponseDiagnostics[]) {
  return Math.round(diagnostics.reduce((total, item) => total + (item.estimatedCostUsd ?? 0), 0) * 10_000) / 10_000;
}

export async function runPaperGenerationBenchmarkCase(runId: string, caseId: string) {
  const db = getAdminDb();
  const [runSnapshot, caseSnapshot] = await Promise.all([runRef(runId).get(), caseRef(runId, caseId).get()]);
  if (!runSnapshot.exists || !caseSnapshot.exists) return "cancelled" as const;
  const run = safeRun(runId, runSnapshot.data() ?? {});
  const item = { id: caseId, ...caseSnapshot.data() } as PaperGenerationBenchmarkCase;
  if (run.cancellationRequested || item.status === "cancelled") return "cancelled" as const;
  if (item.status === "ready") return "ready" as const;
  const estimate = caseEstimate();
  if (estimate === null || run.estimatedCostUsd + estimate > run.spendCeilingUsd) {
    await runRef(runId).update({ status: "paused", pauseReason: "spend_ceiling", updatedAt: Date.now() });
    return "paused" as const;
  }
  const definition = PAPER_GENERATION_BENCHMARK_DEFINITIONS.find((candidate) => candidate.id === item.definitionId);
  if (!definition) throw new Error(`Unknown benchmark definition ${item.definitionId}.`);
  const profile = await getExamFormatProfileVersion(item.profileId, item.profileVersion);
  if (!profile) throw new Error(`Frozen profile ${item.profileId}@${item.profileVersion} is unavailable.`);
  await caseRef(runId, caseId).update({ status: "running", updatedAt: Date.now() });
  await runRef(runId).update({ status: "running", activeCaseId: caseId, updatedAt: Date.now() });
  const source = syntheticSource({
    caseId,
    kind: item.kind,
    subject: profile.subject,
    qualification: profile.qualificationLabel,
    topicExpectations: profile.topicExpectations,
    assessmentObjectives: profile.assessmentObjectives,
  });
  const emphasis = item.kind === "complete_with_emphasis"
    ? ` Give modest extra emphasis to ${profile.topicExpectations.slice(0, 2).join(" and ") || "the opening specification areas"}, without changing the complete-paper format.`
    : "";
  const request = {
    folderId: "benchmark-folder",
    request: `Create a complete ${profile.boardLabel} ${profile.qualificationLabel} ${profile.subject} ${profile.componentTitle} paper.${emphasis}`,
    coverage: "Complete official component",
    length: "full" as const,
    focus: "balanced" as const,
    focusDetail: "",
    timingMode: "timed" as const,
    tutorEnabled: false,
    sourceIds: [source.id],
  };
  const generated = await runPracticePaperGenerationForBenchmark({
    reviewerUid: run.createdBy,
    request,
    sources: [source],
    studyContext: {
      folderName: "Synthetic paper-generation benchmark",
      subject: profile.subject,
      studyLevel: profile.qualificationLabel,
    },
    researchBrief: profile.sources.map((citation) => `${citation.title}: ${citation.url}`).join("\n"),
    formatContext: practicePaperFormatContext(profile),
  });
  const payload = await generated.response.json().catch(() => null) as
    | (PracticePaperGenerationResponse & { code?: string; error?: string })
    | null;
  if (!generated.response.ok || !payload || payload.status !== "ready") {
    const now = Date.now();
    await caseRef(runId, caseId).update({
      status: "failed",
      failureCode: payload?.code ?? "generation_failed",
      updatedAt: now,
    });
    throw new Error(payload?.error ?? "Benchmark generation failed.");
  }
  const paperWithFigures = await createPaperRasterAssets({
    uid: run.createdBy,
    paperId: caseId,
    generated: payload as GeneratedPracticePaper,
    storagePrefix: `internal/paperGenerationBenchmarks/${runId}/assets/${caseId}`,
    persist: async () => undefined,
  });
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    definitionVersion: PAPER_GENERATION_BENCHMARK_VERSION,
    runId,
    caseId,
    profile,
    paper: { status: "ready", ...paperWithFigures },
  }));
  const storagePath = `internal/paperGenerationBenchmarks/${runId}/${caseId}.json`;
  await getAdminStorageBucket().file(storagePath).save(bytes, {
    contentType: "application/json",
    resumable: false,
    metadata: { cacheControl: "private,no-store", metadata: { runId, caseId } },
  });
  const cost = actualCost(generated.diagnostics);
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const latestRun = await transaction.get(runRef(runId));
    if (!latestRun.exists) return;
    const current = safeRun(runId, latestRun.data() ?? {});
    transaction.update(caseRef(runId, caseId), {
      status: "ready",
      paperStoragePath: storagePath,
      contentHash: sha256(bytes),
      estimatedCostUsd: cost,
      completedAt: now,
      updatedAt: now,
    });
    transaction.update(runRef(runId), {
      completedCases: current.completedCases + 1,
      estimatedCostUsd: Math.round((current.estimatedCostUsd + cost) * 10_000) / 10_000,
      activeCaseId: null,
      updatedAt: now,
    });
  });
  return "ready" as const;
}

export async function finishPaperGenerationBenchmarkRun(runId: string) {
  const [runSnapshot, cases] = await Promise.all([
    runRef(runId).get(),
    runRef(runId).collection("cases").get(),
  ]);
  if (!runSnapshot.exists) return;
  const run = safeRun(runId, runSnapshot.data() ?? {});
  const completed = cases.docs.filter((document) => document.data().status === "ready").length;
  const failed = cases.docs.filter((document) => document.data().status === "failed").length;
  await runRef(runId).update({
    completedCases: completed,
    status: run.cancellationRequested ? "cancelled" : failed > 0 ? "failed" : completed === run.expectedCases ? "awaiting_review" : "paused",
    activeCaseId: null,
    updatedAt: Date.now(),
  });
}

export async function listPaperGenerationBenchmarkCaseIds(runId: string) {
  const snapshot = await runRef(runId).collection("cases").get();
  return snapshot.docs.map((document) => document.id).sort((left, right) => left.localeCompare(right));
}

export async function listPaperGenerationBenchmarkRuns(limit = 20) {
  const snapshot = await getAdminDb().collection("paperGenerationBenchmarkRuns")
    .orderBy("updatedAt", "desc").limit(Math.max(1, Math.min(50, limit))).get();
  return snapshot.docs.map((document) => safeRun(document.id, document.data()));
}

export async function getPaperGenerationBenchmarkRun(runId: string) {
  const [runSnapshot, cases] = await Promise.all([
    runRef(runId).get(),
    runRef(runId).collection("cases").get(),
  ]);
  if (!runSnapshot.exists) return null;
  return {
    run: safeRun(runId, runSnapshot.data() ?? {}),
    cases: cases.docs
      .map((document) => {
        const studentSafe = { id: document.id, ...document.data() } as PaperGenerationBenchmarkCase;
        delete studentSafe.paperStoragePath;
        delete studentSafe.privateArtifactPath;
        delete studentSafe.contentHash;
        delete studentSafe.generationJobId;
        return studentSafe as PaperGenerationBenchmarkCase;
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

async function loadRawPaperGenerationBenchmarkArtifact(runId: string, caseId: string) {
  const snapshot = await caseRef(runId, caseId).get();
  const storagePath = typeof snapshot.data()?.paperStoragePath === "string" ? snapshot.data()!.paperStoragePath as string : "";
  if (!snapshot.exists || !storagePath.startsWith(`internal/paperGenerationBenchmarks/${runId}/${caseId}.json`)) return null;
  const [bytes] = await getAdminStorageBucket().file(storagePath).download();
  if (sha256(bytes) !== snapshot.data()?.contentHash) throw new Error("The benchmark artifact failed its integrity check.");
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
}

export async function loadPaperGenerationBenchmarkArtifact(runId: string, caseId: string) {
  const artifact = await loadRawPaperGenerationBenchmarkArtifact(runId, caseId);
  if (!artifact) return null;
  const paper = artifact.paper && typeof artifact.paper === "object"
    ? artifact.paper as Record<string, unknown>
    : {};
  const questions = Array.isArray(paper.questions)
    ? paper.questions.map((question) => {
        if (!question || typeof question !== "object") return question;
        const record = question as Record<string, unknown>;
        const assets = Array.isArray(record.assets)
          ? record.assets.map((asset) => {
              if (!asset || typeof asset !== "object") return asset;
              const { storagePath: _storagePath, ...safeAsset } = asset as Record<string, unknown>;
              return typeof safeAsset.id === "string" && _storagePath
                ? { ...safeAsset, previewUrl: `/api/internal/paper-quality/runs/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}/assets/${encodeURIComponent(safeAsset.id)}` }
                : safeAsset;
            })
          : [];
        return { ...record, assets };
      })
    : [];
  return { ...artifact, paper: { ...paper, questions } };
}

export async function loadPaperGenerationBenchmarkAsset(runId: string, caseId: string, assetId: string) {
  const artifact = await loadRawPaperGenerationBenchmarkArtifact(runId, caseId);
  const paper = artifact?.paper && typeof artifact.paper === "object"
    ? artifact.paper as Record<string, unknown>
    : {};
  const questions = Array.isArray(paper.questions) ? paper.questions : [];
  for (const question of questions) {
    if (!question || typeof question !== "object") continue;
    const assets = Array.isArray((question as Record<string, unknown>).assets)
      ? (question as Record<string, unknown>).assets as unknown[]
      : [];
    const asset = assets.find((candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).id === assetId) as Record<string, unknown> | undefined;
    const storagePath = typeof asset?.storagePath === "string" ? asset.storagePath : "";
    const prefix = `internal/paperGenerationBenchmarks/${runId}/assets/${caseId}/`;
    if (!storagePath.startsWith(prefix)) continue;
    const [bytes] = await getAdminStorageBucket().file(storagePath).download();
    if (bytes.length < 1 || bytes.length > 12 * 1024 * 1024) throw new Error("Benchmark image is invalid.");
    return {
      bytes,
      mimeType: typeof asset?.mimeType === "string" ? asset.mimeType : "image/png",
    };
  }
  return null;
}

function normalizeScores(value: unknown): PaperGenerationBenchmarkReviewScores | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const output = {} as PaperGenerationBenchmarkReviewScores;
  for (const key of SCORE_KEYS) {
    const score = raw[key];
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) return null;
    output[key] = score;
  }
  return output;
}

export async function reviewPaperGenerationBenchmarkCase(input: {
  reviewerUid: string;
  runId: string;
  caseId: string;
  usable: boolean;
  scores: unknown;
  blockers: unknown;
  comments?: string;
}) {
  const scores = normalizeScores(input.scores);
  if (!scores) throw new Error("Complete every review score from 1 to 5.");
  const blockers = Array.isArray(input.blockers)
    ? input.blockers.flatMap((value) => typeof value === "string" && HARD_BLOCKERS.includes(value as PaperGenerationBenchmarkBlocker) ? [value as PaperGenerationBenchmarkBlocker] : [])
    : [];
  if (input.usable && blockers.length > 0) throw new Error("A paper with a hard blocker cannot be marked usable.");
  const now = Date.now();
  const review: PaperGenerationBenchmarkReview = {
    reviewerUid: input.reviewerUid,
    usable: input.usable,
    scores,
    blockers,
    comments: input.comments?.trim().slice(0, 2_000) || undefined,
    reviewedAt: now,
  };
  const db = getAdminDb();
  await db.runTransaction(async (transaction) => {
    const [runSnapshot, caseSnapshot] = await Promise.all([
      transaction.get(runRef(input.runId)),
      transaction.get(caseRef(input.runId, input.caseId)),
    ]);
    if (!runSnapshot.exists || !caseSnapshot.exists || caseSnapshot.data()?.status !== "ready") {
      throw new Error("That benchmark case is not ready for review.");
    }
    const previous = caseSnapshot.data()?.review as PaperGenerationBenchmarkReview | undefined;
    const run = safeRun(input.runId, runSnapshot.data() ?? {});
    transaction.create(caseRef(input.runId, input.caseId).collection("reviewAudits").doc(), review);
    transaction.update(caseRef(input.runId, input.caseId), { review, updatedAt: now });
    transaction.update(runRef(input.runId), {
      reviewedCases: run.reviewedCases + (previous ? 0 : 1),
      passedCases: run.passedCases - (previous?.usable ? 1 : 0) + (review.usable ? 1 : 0),
      updatedAt: now,
    });
  });
  return review;
}

export async function cancelPaperGenerationBenchmarkRun(runId: string) {
  await runRef(runId).update({ cancellationRequested: true, status: "cancelled", updatedAt: Date.now() });
}

export async function resumePaperGenerationBenchmarkRun(runId: string, spendCeilingUsd: number) {
  const snapshot = await runRef(runId).get();
  if (!snapshot.exists) throw new Error("Benchmark run not found.");
  const run = safeRun(runId, snapshot.data() ?? {});
  if (!Number.isFinite(spendCeilingUsd) || spendCeilingUsd <= run.estimatedCostUsd) {
    throw new Error("Set a spend ceiling above the amount already used.");
  }
  await runRef(runId).update({
    spendCeilingUsd: Math.round(spendCeilingUsd * 100) / 100,
    cancellationRequested: false,
    status: "queued",
    updatedAt: Date.now(),
  });
}

export async function approvePaperGenerationBenchmarkRun(runId: string, reviewerUid: string) {
  const detail = await getPaperGenerationBenchmarkRun(runId);
  if (!detail) throw new Error("Benchmark run not found.");
  if (detail.run.kind === "pilot") {
    throw new Error("Pilot runs are for review only and cannot become measured baselines.");
  }
  if (detail.cases.length !== detail.run.expectedCases || detail.cases.some((item) => !item.review)) {
    throw new Error("Every expected paper must be reviewed before approval.");
  }
  if (detail.cases.some((item) => !item.review?.usable || item.review.blockers.length > 0)) {
    throw new Error("Every paper must be usable and free of hard blockers before approval.");
  }
  const report: PaperGenerationBenchmarkReport = {
    schemaVersion: 2,
    runId,
    definitionVersion: detail.run.definitionVersion,
    createdAt: Date.now(),
    expectedCases: detail.run.expectedCases,
    completedCases: detail.cases.filter((item) => item.status === "ready").length,
    reviewedCases: detail.cases.filter((item) => item.review).length,
    hardBlockers: Object.fromEntries(HARD_BLOCKERS.map((blocker) => [blocker, 0])) as Record<PaperGenerationBenchmarkBlocker, number>,
    components: {},
  };
  for (const item of detail.cases) {
    const component = report.components[item.definitionId] ?? {
      profileVersion: item.profileVersion,
      cases: 0,
      usableCases: 0,
      scoreDistributions: Object.fromEntries(SCORE_KEYS.map((key) => [key, []])) as unknown as Record<keyof PaperGenerationBenchmarkReviewScores, number[]>,
    };
    component.cases += 1;
    if (item.review?.usable) component.usableCases += 1;
    for (const key of SCORE_KEYS) component.scoreDistributions[key].push(item.review!.scores[key]);
    report.components[item.definitionId] = component;
  }
  const baseline = {
    schemaVersion: 2,
    version: detail.run.definitionVersion,
    approvedRunId: runId,
    approvedAt: report.createdAt,
    components: Object.fromEntries(PAPER_GENERATION_BENCHMARK_DEFINITIONS.map((definition) => {
      const component = report.components[definition.id];
      return [definition.id, {
        approved: true,
        status: "measured",
        profileId: definition.profileId,
        profileVersion: component.profileVersion,
        scoreDistributions: component.scoreDistributions,
      }];
    })),
  };
  const baselineRef = getAdminDb().collection("paperGenerationBenchmarkBaselines").doc(`${detail.run.definitionVersion}-${runId}`);
  await getAdminDb().runTransaction(async (transaction) => {
    const latest = await transaction.get(runRef(runId));
    if (latest.data()?.status === "approved") return;
    transaction.create(baselineRef, { report, baseline, approvedBy: reviewerUid, approvedAt: report.createdAt });
    transaction.update(runRef(runId), { status: "approved", approvedBy: reviewerUid, approvedAt: report.createdAt, updatedAt: report.createdAt });
  });
  return { report, baseline };
}
