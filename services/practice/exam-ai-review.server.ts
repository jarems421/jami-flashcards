import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { generateAiText } from "@/lib/ai/provider-router";
import { schemeCriteria } from "@/lib/practice/mark-schemes";
import type {
  ExamQuestion,
  ExamQuestionReview,
  ExamQuestionSecret,
} from "@/lib/practice/exam-questions";
import { parseJsonObject } from "@/services/ai/practice-paper-generation.server";
import { getAdminStorageBucket } from "@/services/firebase/admin";

/**
 * Checking an extracted question against the page it was taken from.
 *
 * This is the review, not a second opinion on it. Every question ingested
 * carries a render of its own source page, so the reviewer is shown the
 * original and asked whether the extraction matches it -- which is a question
 * with an answer on the page, unlike "is this a good question".
 *
 * It runs on `documentVision` because that is the only role whose capability
 * entry claims image input and which is actually reached through a provider
 * that accepts it. The ingest-time audit pass sends PDFs to `supervisor`,
 * whose own entry declares no document modality; that pass is not trusted here
 * and its verdict is treated as a hint rather than a gate.
 */
const REVIEW_INSTRUCTION = `You verify that an exam question was extracted correctly from its source page.

You are given the rendered original page and the extracted record. Decide only whether the extraction is faithful. Do not judge whether the question is a good question, and never rewrite it.

Reject when any of these is true:
- the prompt is not what the page says, or is truncated, or has absorbed a neighbouring question
- the mark total does not match the tariff printed on the page
- the question depends on a figure, table, diagram or extract that the prompt does not contain
- the mark scheme criteria are for a different question, or do not add up to the tariff
- the question number or label does not match the page

Return ONLY JSON: {"verdict":"approve"|"reject","confidence":0..1,"issues":[string]}
issues names what is wrong, one short sentence each, and is empty when approving. Be strict: a student is marked against this.`;

export type ExamAiReviewOutcome = {
  questionId: string;
  review: ExamQuestionReview;
};

/** Below this the model is not sure enough to be the only thing checking. */
const MIN_CONFIDENCE = 0.75;

async function sourcePageParts(question: ExamQuestion): Promise<AiContentPart[]> {
  const asset = question.assets.find(
    (item) => item.storagePath?.startsWith("internal/examQuestionBank/") && item.mimeType === "image/png"
  );
  if (!asset?.storagePath) return [];
  const [bytes] = await getAdminStorageBucket().file(asset.storagePath).download();
  if (bytes.length > 8 * 1024 * 1024) return [];
  return [
    { text: "The rendered original page this question was taken from:" },
    { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } },
  ];
}

export async function reviewExamQuestionWithAi(input: {
  question: ExamQuestion;
  secret: ExamQuestionSecret | undefined;
  model?: string;
}): Promise<ExamAiReviewOutcome> {
  const { question, secret } = input;
  const now = Date.now();
  const reject = (note: string): ExamAiReviewOutcome => ({
    questionId: question.id,
    review: { status: "rejected", by: "ai", at: now, notes: [note] },
  });

  if (!secret) return reject("No mark scheme was stored for this question.");
  const criteria = schemeCriteria(secret.markSchemeItem);
  if (criteria.length === 0) return reject("The mark scheme has no awardable criteria.");

  const pageParts = await sourcePageParts(question).catch(() => []);
  // Without the page there is nothing to check the extraction against, and
  // approving on the extraction's own say-so would be reviewing it against
  // itself.
  if (pageParts.length === 0) {
    return reject("The rendered source page is missing, so the extraction cannot be verified.");
  }

  const record = {
    label: question.label,
    questionNumber: question.provenance.questionNumber,
    prompt: question.prompt,
    marks: question.marks,
    markSchemeRegime: secret.markSchemeItem.marking,
    criteria: criteria.map((item) => ({ id: item.id, marks: item.marks, text: item.text })),
    criteriaMarkTotal: criteria.reduce((sum, item) => sum + item.marks, 0),
  };

  let response: string;
  try {
    response = await generateAiText({
      role: "documentVision",
      taskClass: "visual",
      timeoutMs: 40_000,
      deadlineAt: Date.now() + 45_000,
      generationConfig: { temperature: 0, topP: 0.6, maxOutputTokens: 1_500 },
      request: {
        systemInstruction: REVIEW_INSTRUCTION,
        contents: [{ role: "user", parts: [...pageParts, { text: `Extracted record:\n${JSON.stringify(record, null, 2)}` }] }],
      },
    });
  } catch {
    return reject("The reviewer could not be reached; this question was left unapproved.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonObject(response);
  } catch {
    return reject("The reviewer returned an unreadable verdict.");
  }

  const issues = Array.isArray(payload.issues)
    ? payload.issues.filter((item): item is string => typeof item === "string").slice(0, 10)
    : [];
  const confidence = typeof payload.confidence === "number" ? payload.confidence : 0;
  const approved = payload.verdict === "approve" && issues.length === 0 && confidence >= MIN_CONFIDENCE;

  return {
    questionId: question.id,
    review: {
      status: approved ? "approved" : "rejected",
      by: "ai",
      model: input.model,
      at: now,
      notes: approved
        ? [`Checked against the source page. Confidence ${confidence.toFixed(2)}.`]
        : issues.length > 0
          ? issues
          : [`Not approved: confidence ${confidence.toFixed(2)} is below the ${MIN_CONFIDENCE} bar.`],
    },
  };
}
