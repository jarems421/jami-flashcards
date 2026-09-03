import "server-only";

import { aiSpendContextFor } from "@/services/ai/spend.server";
import { runWithAiSpendContext } from "@/lib/ai/spend-context";
import { Timestamp } from "firebase-admin/firestore";
import sharp from "sharp";

import type { AiBudgetGrant } from "@/lib/ai/budgets";
import {
  buildPracticePaperResearchQuery,
  parsePracticePaperGenerationRequest,
  practicePaperNeedsWebResearch,
  type PracticePaperGenerationRequest,
} from "@/lib/ai/practice-paper-generation";
import { generateAiText } from "@/lib/ai/provider-router";
import { generateGeminiImage, generateGroundedResearch } from "@/lib/ai/gemini";
import { mapSourceData } from "@/lib/material/sources";
import {
  buildPracticePaperPayload,
  type GeneratedPracticePaper,
  type PracticePaperGenerationResponse,
  type PracticePaperQuestionAsset,
  type PracticePaperResearchReceipt,
} from "@/lib/practice/practice-papers";
import {
  normalizePracticePaperBrief,
  practicePaperFormatIssues,
  type ExamFormatProfileVersion,
  type PracticePaperBrief,
} from "@/lib/practice/exam-formats";
import { getPracticePaperJobProgress } from "@/lib/practice/practice-paper-jobs";
import { buildNotebookPagePayload, buildNotebookPayload } from "@/lib/workspace/notebooks";
import { runPracticePaperGenerationForWorkflow } from "@/services/ai/practice-paper-generation.server";
import {
  findOriginalPracticePaperConflicts,
  resolvePracticePaperFormat,
} from "@/services/ai/exam-format-library.server";
import { practicePaperSecretRef } from "@/services/ai/practice-paper-secrets.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

type PrivateJob = {
  paperId: string;
  request: PracticePaperGenerationRequest;
  budgetGrant: AiBudgetGrant;
};

type WorkflowGenerationStatus = "cancelled" | "needs_confirmation" | "needs_clarification" | "ready";

type PrivateJobArtifact = {
  research?: {
    brief: string;
    receipt: PracticePaperResearchReceipt | null;
    completedAt: number;
  };
  format?: {
    resolved: true;
    profile?: ExamFormatProfileVersion;
    brief?: PracticePaperBrief;
    promptContext?: string;
    completedAt: number;
  };
  generation?: {
    response: PracticePaperGenerationResponse;
    completedAt: number;
  };
  figures?: {
    generated: GeneratedPracticePaper;
    completedAt?: number;
    updatedAt: number;
  };
};

const TERMINAL_JOB_RETENTION_MS = 30 * 24 * 60 * 60_000;

function formatConfirmationEnabled() {
  return process.env.PAPER_FORMAT_CONFIRMATION_ENABLED === "true";
}

function firestoreSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jobRefs(uid: string, jobId: string) {
  const userRef = getAdminDb().collection("users").doc(uid);
  return {
    userRef,
    jobRef: userRef.collection("practicePaperJobs").doc(jobId),
    artifactRef: userRef.collection("practicePaperJobArtifacts").doc(jobId),
  };
}

function parsePrivateJob(value: Record<string, unknown>): PrivateJob | null {
  const paperId = typeof value.paperId === "string" ? value.paperId.trim() : "";
  const request = parsePracticePaperGenerationRequest(value.request);
  const grant = value.budgetGrant && typeof value.budgetGrant === "object"
    ? value.budgetGrant as Record<string, unknown>
    : null;
  if (
    !paperId ||
    !request ||
    !grant ||
    typeof grant.uid !== "string" ||
    typeof grant.action !== "string" ||
    typeof grant.dayKey !== "string" ||
    typeof grant.burstWindowStartedAt !== "number"
  ) return null;
  return { paperId, request, budgetGrant: grant as AiBudgetGrant };
}

async function loadPrivateState(uid: string, jobId: string) {
  const { jobRef, artifactRef } = jobRefs(uid, jobId);
  const [jobSnapshot, artifactSnapshot] = await Promise.all([
    jobRef.get(),
    artifactRef.get(),
  ]);
  if (!jobSnapshot.exists || jobSnapshot.data()?.cancellationRequested === true) {
    return { status: "cancelled" as const, jobRef, artifactRef };
  }
  const job = parsePrivateJob(jobSnapshot.data() ?? {});
  if (!job) throw new Error("The queued practice-paper request is invalid.");
  return {
    status: "ready" as const,
    job,
    jobData: jobSnapshot.data() ?? {},
    artifact: (artifactSnapshot.data() ?? {}) as PrivateJobArtifact,
    jobRef,
    artifactRef,
  };
}

function authorityForUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host.endsWith(".gov.uk") ||
      host.endsWith(".ac.uk") ||
      /(?:^|\.)(?:aqa|ocr|wjec|eduqas|ccea)\.org\.uk$/.test(host) ||
      host.includes("qualifications.pearson.com") ||
      host.includes("cambridgeinternational.org")
    ) return "official" as const;
  } catch {
    return "credible" as const;
  }
  return "credible" as const;
}

function roleForCitation(title: string) {
  const normalized = title.toLowerCase();
  if (/specification|syllabus/.test(normalized)) return "specification" as const;
  if (/paper|exam|assessment|format/.test(normalized)) return "format" as const;
  if (/guide|rubric|mark|report/.test(normalized)) return "guidance" as const;
  return "background" as const;
}

async function buildResearchContext(uid: string, request: PracticePaperGenerationRequest) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const [folder, user, sourceSnapshots] = await Promise.all([
    userRef.collection("studyFolders").doc(request.folderId).get(),
    userRef.get(),
    request.sourceIds.length > 0
      ? Promise.all(request.sourceIds.map((sourceId) =>
          userRef.collection("sources").doc(sourceId).get()
        ))
      : userRef.collection("sources")
          .where("folderIds", "array-contains", request.folderId)
          .limit(15)
          .get()
          .then((snapshot) => snapshot.docs),
  ]);
  const sources = sourceSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => mapSourceData(snapshot.id, snapshot.data() ?? {}))
    .filter((source) => source.status === "active");
  const folderData = folder.data() ?? {};
  // Folder names are user-authored and may contain names or private prose.
  // Only the dedicated, sanitised subject field may enter a public query.
  const subject = typeof folderData.subject === "string" ? folderData.subject : "";
  const studyLevel = typeof folderData.studyLevel === "string"
    ? folderData.studyLevel
    : typeof user.data()?.defaultStudyLevel === "string"
      ? user.data()?.defaultStudyLevel as string
      : "";
  if (!practicePaperNeedsWebResearch(sources)) {
    return { brief: "", receipt: null, subject, studyLevel };
  }
  const sanitizedQuery = buildPracticePaperResearchQuery({
    subject,
    studyLevel,
    request: request.request,
  });
  const result = await generateGroundedResearch({
    sanitizedQuery,
    urls: sources.flatMap((source) =>
      source.type === "link" && source.externalUrl ? [source.externalUrl] : []
    ),
  });
  if (!result.ok) return { brief: "", receipt: null, subject, studyLevel };
  const citations = result.citations.map((citation) => ({
    title: citation.title,
    url: citation.url,
    authority: authorityForUrl(citation.url),
    role: roleForCitation(citation.title),
  }));
  const officialCount = citations.filter((citation) => citation.authority === "official").length;
  const receipt: PracticePaperResearchReceipt = {
    used: citations.length > 0,
    summary: officialCount > 0
      ? `Checked ${officialCount} official source${officialCount === 1 ? "" : "s"} to fill assessment-format gaps.`
      : "Checked public sources for assessment-format context; no official page was confirmed.",
    confidence: officialCount >= 2 ? "high" : officialCount === 1 ? "medium" : "low",
    citations,
  };
  return { brief: result.brief, receipt, subject, studyLevel };
}

function inferredBrief(response: Extract<PracticePaperGenerationResponse, { status: "ready" }>): PracticePaperBrief {
  const profile = response.assessmentProfile;
  return {
    board: profile.awardingBodyOrInstitution || "Not confirmed",
    qualification: profile.qualificationOrModule || profile.studyLevel,
    subject: profile.specificationOrCourse || profile.qualificationOrModule,
    specification: profile.specificationOrCourse || "Not confirmed",
    component: profile.tierOrComponent || "Complete written paper",
    durationMinutes: response.durationMinutes,
    totalMarks: response.totalMarks,
    materials: response.companionDocuments?.map((document) => document.title) ?? [],
    verificationStatus: "limited",
    confidence: profile.confidence,
    requiresConfirmation: profile.confidence === "low",
    customFallbackAvailable: true,
  };
}

async function verifiedFormatReleaseIssues(
  payload: Extract<PracticePaperGenerationResponse, { status: "ready" }>,
  profile: ExamFormatProfileVersion
) {
  const issues = practicePaperFormatIssues(payload, profile);
  const requiredCompanions = profile.requiredMaterials.filter((material) =>
    material.supplied && material.kind !== "permitted_text"
  );
  const companionRoles = new Set<string>(payload.companionDocuments?.map((document) => document.role) ?? []);
  if (requiredCompanions.some((material) => !companionRoles.has(material.kind))) {
    issues.push("A required candidate insert was not generated.");
  }
  const originalityConflicts = await findOriginalPracticePaperConflicts(
    profile.profileId,
    payload.questions
  );
  if (originalityConflicts.length > 0) {
    issues.push("Distinctive wording overlapped a reference paper.");
  }
  return issues;
}

function rasterBriefs(generated: GeneratedPracticePaper) {
  return generated.questions.flatMap((question) =>
    question.assets.flatMap((asset) =>
      (asset.type === "image" || asset.type === "illustration") &&
      (!asset.storagePath || asset.validationStatus !== "valid")
        ? [{ question, asset }]
        : []
    )
  ).slice(0, 8);
}

async function validateGeneratedPaperImage(input: {
  question: string;
  brief: string;
  markScheme: string;
  data: string;
  mimeType: string;
}) {
  const text = await generateAiText({
    role: "supervisor",
    taskClass: "important",
    timeoutMs: 60_000,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 500,
      responseMimeType: "application/json",
    },
    request: {
      systemInstruction: "You are Jami's final visual assessment validator. Reject misleading, unreadable, answer-leaking or question-inconsistent figures. Return JSON only.",
      contents: [{
        role: "user",
        parts: [
          { text: `Question: ${input.question}\nRequired visual: ${input.brief}\nMark scheme: ${input.markScheme}\nReturn {"valid":true,"reason":"..."}.` },
          { inlineData: { data: input.data, mimeType: input.mimeType } },
        ],
      }],
    },
  });
  try {
    const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return (JSON.parse(normalized) as Record<string, unknown>).valid === true;
  } catch {
    return false;
  }
}

function replaceAsset(
  generated: GeneratedPracticePaper,
  questionId: string,
  assetId: string,
  replacement: PracticePaperQuestionAsset
) {
  return {
    ...generated,
    questions: generated.questions.map((question) =>
      question.id === questionId
        ? {
            ...question,
            assets: question.assets.map((asset) =>
              asset.id === assetId ? replacement : asset
            ),
          }
        : question
    ),
  };
}

export async function createPaperRasterAssets(input: {
  uid: string;
  paperId: string;
  generated: GeneratedPracticePaper;
  persist: (generated: GeneratedPracticePaper) => Promise<void>;
  storagePrefix?: string;
}) {
  let current = input.generated;
  const briefs = rasterBriefs(current);
  if (briefs.length === 0) return current;
  const bucket = getAdminStorageBucket();
  for (const { question, asset } of briefs) {
    const prompt = [
      "Create an accurate, accessible educational visual for a formal practice paper.",
      `Assessment: ${current.assessmentProfile.qualificationOrModule}.`,
      `Question: ${question.prompt}`,
      `Required figure: ${asset.content || asset.title}`,
      `Alt-text intent: ${asset.altText}`,
      "Do not include an answer, solution, grading cue, watermark, or decorative clutter.",
      "All labels and quantities must agree exactly with the question.",
    ].join("\n");
    let generatedImage: Awaited<ReturnType<typeof generateGeminiImage>> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const candidate = await generateGeminiImage({
          role: "paperImage",
          prompt,
          aspectRatio: "4:3",
          imageSize: "1K",
        });
        const scheme = current.markScheme.items.find(
          (item) => item.questionId === question.id
        );
        const valid = await validateGeneratedPaperImage({
          question: question.prompt,
          brief: asset.content || asset.title,
          markScheme: scheme?.answer ?? "",
          data: candidate.data,
          mimeType: candidate.mimeType,
        });
        if (valid) {
          generatedImage = candidate;
          break;
        }
        lastError = new Error(`Required visual ${asset.id} did not pass validation.`);
      } catch (error) {
        lastError = error;
      }
    }
    if (!generatedImage) {
      // Fall back to a deterministic accessible figure when image generation
      // is disabled or fails twice. The paper is never released with a
      // pending/missing visual.
      const deterministicContent = (asset.content || asset.altText || asset.title).trim();
      if (!deterministicContent) {
        throw lastError instanceof Error
          ? lastError
          : new Error(`Required visual ${asset.id} could not be represented safely.`);
      }
      current = replaceAsset(current, question.id, asset.id, {
        ...asset,
        type: "diagram",
        content: deterministicContent,
        storagePath: undefined,
        mimeType: undefined,
        source: "deterministic",
        validationStatus: "valid",
        caption: asset.caption || asset.title,
      });
      await input.persist(current);
      continue;
    }
    const extension = generatedImage.mimeType.includes("jpeg") ? "jpg" : "png";
    const safeAssetId = asset.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
    const safeQuestionId = question.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
    const storageRoot = input.storagePrefix?.replace(/^\/+|\/+$/g, "")
      || `users/${input.uid}/generatedPaperAssets/${input.paperId}`;
    const storagePath = `${storageRoot}/${safeQuestionId}-${safeAssetId}.${extension}`;
    const bytes = Buffer.from(generatedImage.data, "base64");
    if (bytes.length === 0 || bytes.length > 12 * 1024 * 1024) {
      throw new Error(`Required visual ${asset.id} returned invalid image data.`);
    }
    const dimensions = await sharp(bytes).metadata();
    if (!dimensions.width || !dimensions.height) {
      throw new Error(`Required visual ${asset.id} returned unreadable image data.`);
    }
    await bucket.file(storagePath).save(bytes, {
      contentType: generatedImage.mimeType,
      resumable: false,
      metadata: {
        cacheControl: "private,max-age=3600",
        metadata: { uid: input.uid, paperId: input.paperId, assetId: asset.id },
      },
    });
    current = replaceAsset(current, question.id, asset.id, {
      ...asset,
      content: "",
      storagePath,
      mimeType: generatedImage.mimeType,
      width: dimensions.width,
      height: dimensions.height,
      caption: asset.caption || asset.title,
      source: "generated",
      validationStatus: "valid",
    });
    // Each accepted image is a checkpoint. A retry sees its private path and
    // starts with the first unfinished asset instead of paying twice.
    await input.persist(current);
  }
  return current;
}

export async function prepareQueuedPracticePaperResearch(uid: string, jobId: string) {
  return runWithAiSpendContext(aiSpendContextFor(uid, "practicePaperGeneration"), () =>
    prepareQueuedPracticePaperResearchMetered(uid, jobId)
  );
}

async function prepareQueuedPracticePaperResearchMetered(
  uid: string,
  jobId: string
): Promise<WorkflowGenerationStatus> {
  const state = await loadPrivateState(uid, jobId);
  if (state.status === "cancelled") return "cancelled";
  if (state.artifact.research && state.artifact.format) {
    if (
      formatConfirmationEnabled() &&
      state.artifact.format.brief?.requiresConfirmation &&
      state.jobData.formatConfirmed !== true &&
      state.jobData.customFormatAllowed !== true
    ) return "needs_confirmation";
    return "ready";
  }
  await state.jobRef.update({
    status: "running",
    stage: "researching",
    progress: getPracticePaperJobProgress("researching"),
    updatedAt: Date.now(),
  });
  const research = await buildResearchContext(uid, state.job.request);
  const format = await resolvePracticePaperFormat({
    request: state.job.request.request,
    coverage: state.job.request.coverage,
    subject: research.subject,
    studyLevel: research.studyLevel,
  });
  const latestJob = await state.jobRef.get();
  if (!latestJob.exists || latestJob.data()?.cancellationRequested === true) {
    return "cancelled";
  }
  const now = Date.now();
  await state.artifactRef.set({
    research: firestoreSafe({ brief: research.brief, receipt: research.receipt, completedAt: now }),
    format: firestoreSafe({
      resolved: true,
      profile: format?.profile,
      brief: format?.brief,
      promptContext: format?.promptContext,
      completedAt: now,
    }),
    updatedAt: now,
  }, { merge: true });
  if (format?.brief) {
    await state.jobRef.update({ paperBrief: firestoreSafe(format.brief), updatedAt: now });
  }
  if (
    formatConfirmationEnabled() &&
    format?.brief.requiresConfirmation &&
    state.jobData.formatConfirmed !== true &&
    state.jobData.customFormatAllowed !== true
  ) {
    await state.jobRef.update({
      status: "needs_confirmation",
      paperBrief: firestoreSafe(format.brief),
      expiresAt: Timestamp.fromMillis(now + TERMINAL_JOB_RETENTION_MS),
      completedAt: now,
      updatedAt: now,
    });
    return "needs_confirmation";
  }
  return "ready";
}

export async function generateQueuedPracticePaperDraft(uid: string, jobId: string) {
  return runWithAiSpendContext(aiSpendContextFor(uid, "practicePaperGeneration"), () =>
    generateQueuedPracticePaperDraftMetered(uid, jobId)
  );
}

async function generateQueuedPracticePaperDraftMetered(
  uid: string,
  jobId: string
): Promise<WorkflowGenerationStatus> {
  const state = await loadPrivateState(uid, jobId);
  if (state.status === "cancelled") return "cancelled";
  if (state.artifact.generation) {
    if (state.artifact.generation.response.status === "needs_clarification") return "needs_clarification";
    const brief = normalizePracticePaperBrief(state.jobData.paperBrief);
    if (formatConfirmationEnabled() && brief?.requiresConfirmation && state.jobData.formatConfirmed !== true && state.jobData.customFormatAllowed !== true) {
      return "needs_confirmation";
    }
    return "ready";
  }
  await state.jobRef.update({ providerStartedAt: Date.now(), updatedAt: Date.now() });
  const response = await runPracticePaperGenerationForWorkflow({
    uid,
    jobId,
    request: state.job.request,
    researchBrief: state.artifact.research?.brief ?? "",
    formatContext: state.jobData.customFormatAllowed === true
      ? undefined
      : state.artifact.format?.promptContext,
  });
  const rawPayload = (await response.json().catch(() => null)) as
    | (PracticePaperGenerationResponse & { error?: string; code?: string })
    | null;
  if (!response.ok || !rawPayload) {
    if (rawPayload?.code === "cancelled") return "cancelled";
    throw new Error(rawPayload?.error || "Jami could not finish that paper just now.");
  }
  let payload = rawPayload;
  if (payload.status === "ready") {
    const profile = state.artifact.format?.profile;
    if (profile && state.jobData.customFormatAllowed !== true) {
      let releaseIssues = await verifiedFormatReleaseIssues(payload, profile);
      if (releaseIssues.length > 0) {
        const repairedResponse = await runPracticePaperGenerationForWorkflow({
          uid,
          jobId,
          request: state.job.request,
          researchBrief: state.artifact.research?.brief ?? "",
          formatContext: [
            state.artifact.format?.promptContext,
            "The previous draft was rejected during final structural/originality validation.",
            `Repair findings: ${releaseIssues.join(" ")}`,
            "Generate a materially new complete paper, preserving the verified format exactly and avoiding distinctive reference wording.",
          ].filter(Boolean).join("\n"),
        });
        const repairedPayload = (await repairedResponse.json().catch(() => null)) as
          | (PracticePaperGenerationResponse & { error?: string; code?: string })
          | null;
        if (!repairedResponse.ok || !repairedPayload || repairedPayload.status !== "ready") {
          throw new Error(repairedPayload?.error || "Jami could not repair the paper safely.");
        }
        payload = repairedPayload;
        releaseIssues = await verifiedFormatReleaseIssues(payload, profile);
        if (releaseIssues.length > 0) {
          throw new Error(`The paper did not pass final format checks: ${releaseIssues.join(" ")}`);
        }
      }
      payload = {
        ...payload,
        assessmentProfile: {
          ...payload.assessmentProfile,
          profileId: profile.profileId,
          profileVersion: profile.version,
          verificationStatus: profile.verificationStatus,
          effectiveFrom: profile.effectiveFrom,
          effectiveUntil: profile.effectiveUntil,
        },
      };
    } else if (state.jobData.customFormatAllowed === true) {
      payload = {
        ...payload,
        assessmentProfile: { ...payload.assessmentProfile, verificationStatus: "custom" },
      };
    } else {
      payload = {
        ...payload,
        assessmentProfile: { ...payload.assessmentProfile, verificationStatus: "limited" },
      };
    }
  }
  const latestJob = await state.jobRef.get();
  if (!latestJob.exists || latestJob.data()?.cancellationRequested === true) {
    return "cancelled";
  }
  const now = Date.now();
  await state.artifactRef.set({
    generation: firestoreSafe({ response: payload, completedAt: now }),
    ...(payload.status === "needs_clarification"
      ? { expiresAt: Timestamp.fromMillis(now + TERMINAL_JOB_RETENTION_MS) }
      : {}),
    updatedAt: now,
  }, { merge: true });
  if (payload.status === "needs_clarification") {
    await state.jobRef.update({
      status: "needs_clarification",
      clarificationQuestion: payload.question,
      expiresAt: Timestamp.fromMillis(now + TERMINAL_JOB_RETENTION_MS),
      completedAt: now,
      updatedAt: now,
    });
    return "needs_clarification";
  }
  const brief = state.artifact.format?.brief ?? inferredBrief(payload);
  const waitingForConfirmation = formatConfirmationEnabled() && brief.requiresConfirmation &&
    state.jobData.formatConfirmed !== true &&
    state.jobData.customFormatAllowed !== true;
  await state.jobRef.update({ paperBrief: firestoreSafe(brief), updatedAt: now });
  if (waitingForConfirmation) {
    await state.jobRef.update({
      status: "needs_confirmation",
      expiresAt: Timestamp.fromMillis(now + TERMINAL_JOB_RETENTION_MS),
      completedAt: now,
      updatedAt: now,
    });
    return "needs_confirmation";
  }
  return "ready";
}

export async function createQueuedPracticePaperFigures(uid: string, jobId: string) {
  return runWithAiSpendContext(aiSpendContextFor(uid, "practicePaperGeneration"), () =>
    createQueuedPracticePaperFiguresMetered(uid, jobId)
  );
}

async function createQueuedPracticePaperFiguresMetered(
  uid: string,
  jobId: string
): Promise<WorkflowGenerationStatus> {
  const state = await loadPrivateState(uid, jobId);
  if (state.status === "cancelled") return "cancelled";
  const response = state.artifact.generation?.response;
  if (!response) throw new Error("The paper draft checkpoint is missing.");
  if (response.status === "needs_clarification") return "needs_clarification";
  if (state.artifact.figures?.completedAt) return "ready";
  await state.jobRef.update({
    status: "running",
    stage: "creating_figures",
    progress: getPracticePaperJobProgress("creating_figures"),
    updatedAt: Date.now(),
  });
  const generated: GeneratedPracticePaper = {
    ...response,
    researchReceipt: state.artifact.research?.receipt ?? undefined,
  };
  const startingPoint = state.artifact.figures?.generated ?? generated;
  const persist = async (next: GeneratedPracticePaper) => {
    const now = Date.now();
    await state.artifactRef.set({
      figures: firestoreSafe({ generated: next, updatedAt: now }),
      updatedAt: now,
    }, { merge: true });
  };
  const completed = await createPaperRasterAssets({
    uid,
    paperId: state.job.paperId,
    generated: startingPoint,
    persist,
  });
  const now = Date.now();
  await state.artifactRef.set({
    figures: firestoreSafe({ generated: completed, completedAt: now, updatedAt: now }),
    updatedAt: now,
  }, { merge: true });
  return "ready";
}

export async function finalizeQueuedPracticePaper(uid: string, jobId: string) {
  return runWithAiSpendContext(aiSpendContextFor(uid, "practicePaperGeneration"), () =>
    finalizeQueuedPracticePaperMetered(uid, jobId)
  );
}

async function finalizeQueuedPracticePaperMetered(
  uid: string,
  jobId: string
): Promise<WorkflowGenerationStatus> {
  const state = await loadPrivateState(uid, jobId);
  if (state.status === "cancelled") return "cancelled";
  const response = state.artifact.generation?.response;
  if (!response) throw new Error("The paper draft checkpoint is missing.");
  if (response.status === "needs_clarification") return "needs_clarification";
  const generated = state.artifact.figures?.generated ?? response;
  const temporarySourceIds = new Set(
    Array.isArray(state.jobData.temporarySourceIds)
      ? (state.jobData.temporarySourceIds as unknown[]).flatMap((value) =>
          typeof value === "string" ? [value] : []
        )
      : []
  );
  const persistentSources = generated.sourceIds.flatMap((sourceId, index) =>
    temporarySourceIds.has(sourceId)
      ? []
      : [{ id: sourceId, label: generated.sourceLabels[index] ?? "Source" }]
  );
  const incompleteVisual = rasterBriefs(generated)[0];
  if (incompleteVisual) {
    throw new Error(`Required visual ${incompleteVisual.asset.id} is incomplete.`);
  }

  const { userRef, jobRef, artifactRef } = jobRefs(uid, jobId);
  const paperRef = userRef.collection("pastPapers").doc(state.job.paperId);
  const existingPaper = await paperRef.get();
  if (existingPaper.exists) {
    await jobRef.update({
      title: generated.title,
      status: "ready",
      stage: "ready",
      progress: 100,
      cancellationRequested: false,
      readyUnread: true,
      expiresAt: Timestamp.fromMillis(Date.now() + TERMINAL_JOB_RETENTION_MS),
      completedAt: state.jobData.completedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    await artifactRef.delete().catch(() => undefined);
    return "ready";
  }

  await jobRef.update({
    stage: "final_checks",
    progress: getPracticePaperJobProgress("final_checks"),
    updatedAt: Date.now(),
  });
  const now = Date.now();
  const notebookRef = userRef.collection("notebooks").doc(state.job.paperId);
  const db = getAdminDb();
  const batch = db.batch();
  batch.set(notebookRef, buildNotebookPayload({
    folderId: state.job.request.folderId,
    title: generated.title,
    type: "practice_paper",
    sourceIds: persistentSources.map((source) => source.id),
    pastPaperId: state.job.paperId,
    color: "violet",
    icon: "notebook",
    pageColor: "white",
    pageStyle: "plain",
    now,
  }));
  generated.questions.forEach((question, index) => {
    const safeQuestionId = question.id.replace(/[^A-Za-z0-9_-]/g, "-");
    const pageRef = userRef.collection("notebookPages")
      .doc(`${state.job.paperId}_${safeQuestionId}`.slice(0, 1_400));
    batch.set(pageRef, buildNotebookPagePayload({
      notebookId: state.job.paperId,
      folderId: state.job.request.folderId,
      pageNumber: index + 1,
      title: question.label,
      pageType: "question",
      pageColor: "white",
      pageStyle: "plain",
      status: "blank",
      questionPrompt: `${question.prompt}\n\n[${question.marks} ${question.marks === 1 ? "mark" : "marks"}]`,
      questionAssets: question.assets,
      linkedQuestionId: question.id,
      linkedPastPaperId: state.job.paperId,
      now,
    }));
  });
  batch.set(paperRef, buildPracticePaperPayload({
    notebookId: state.job.paperId,
    folderId: state.job.request.folderId,
    title: generated.title,
    origin: "generated",
    status: "ready",
    sourceIds: persistentSources.map((source) => source.id),
    sourceLabels: persistentSources.map((source) => source.label),
    request: state.job.request.request,
    coverage: state.job.request.coverage,
    length: "full",
    focus: state.job.request.focus,
    focusDetail: state.job.request.focusDetail,
    durationMinutes: generated.durationMinutes,
    timingMode: state.job.request.timingMode,
    timingState: "not_started",
    totalPausedMs: 0,
    deadlineVersion: 0,
    tutorEnabled: state.job.request.tutorEnabled,
    tutorUsed: false,
    timerEnabled: state.job.request.timingMode === "timed",
    instructions: generated.instructions,
    companionDocuments: generated.companionDocuments ?? [],
    assessmentProfile: generated.assessmentProfile,
    questions: generated.questions,
    choiceGroups: generated.choiceGroups,
    totalMarks: generated.totalMarks,
    markScheme: generated.markScheme,
    preparedAt: now,
    gradeGuidance: generated.gradeGuidance,
    examinerInsights: generated.examinerInsights,
    generationAudit: generated.generationAudit,
    researchReceipt: generated.researchReceipt,
    attemptCount: 0,
    now,
  }));
  batch.set(practicePaperSecretRef(uid, state.job.paperId), {
    paperId: state.job.paperId,
    markScheme: generated.markScheme,
    createdAt: now,
    updatedAt: now,
  });
  batch.update(jobRef, {
    title: generated.title,
    status: "ready",
    stage: "ready",
    progress: 100,
    cancellationRequested: false,
    readyUnread: true,
    expiresAt: Timestamp.fromMillis(now + TERMINAL_JOB_RETENTION_MS),
    researchReceipt: generated.researchReceipt ?? null,
    completedAt: now,
    updatedAt: now,
  });
  batch.delete(artifactRef);
  await batch.commit();
  return "ready";
}

export async function cleanPracticePaperWorkflowRemnants(uid: string, jobId: string) {
  const { jobRef, artifactRef } = jobRefs(uid, jobId);
  const snapshot = await jobRef.get();
  const paperId = typeof snapshot.data()?.paperId === "string"
    ? snapshot.data()?.paperId as string
    : "";
  await Promise.all([
    artifactRef.delete().catch(() => undefined),
    paperId
      ? getAdminStorageBucket().deleteFiles({
          prefix: `users/${uid}/generatedPaperAssets/${paperId}/`,
          force: true,
        }).catch(() => undefined)
      : Promise.resolve(),
  ]);
}

export async function cleanTemporaryPracticePaperSources(uid: string, jobId: string) {
  const { jobRef } = jobRefs(uid, jobId);
  const snapshot = await jobRef.get();
  if (!snapshot.exists || snapshot.data()?.temporarySourcesCleaned === true) return;
  const sourceIds = Array.isArray(snapshot.data()?.temporarySourceIds)
    ? (snapshot.data()?.temporarySourceIds as unknown[]).flatMap((value) =>
        typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value)
          ? [value]
          : []
      )
    : [];
  if (sourceIds.length === 0) {
    await jobRef.update({ temporarySourcesCleaned: true, updatedAt: Date.now() });
    return;
  }
  const userRef = getAdminDb().collection("users").doc(uid);
  const sourceSnapshots = await Promise.all(
    sourceIds.map((sourceId) => userRef.collection("sources").doc(sourceId).get())
  );
  const { deleteSourceIndex } = await import("@/services/ai/source-index.server");
  await Promise.all(sourceSnapshots.map(async (sourceSnapshot) => {
    if (!sourceSnapshot.exists) return;
    const storagePath = typeof sourceSnapshot.data()?.storagePath === "string"
      ? sourceSnapshot.data()?.storagePath as string
      : "";
    if (storagePath) {
      await getAdminStorageBucket().file(storagePath).delete({ ignoreNotFound: true })
        .catch(() => undefined);
    }
    await deleteSourceIndex(uid, sourceSnapshot.id).catch(() => undefined);
    await sourceSnapshot.ref.delete().catch(() => undefined);
  }));
  await jobRef.update({
    temporarySourcesCleaned: true,
    temporarySourceIds: [],
    updatedAt: Date.now(),
  });
}
