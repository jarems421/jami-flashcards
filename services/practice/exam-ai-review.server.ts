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
 * This is the review, not a second opinion on it. A question is stored with a
 * render of its own region of the paper and of the scheme page it was paired
 * to, so the reviewer is shown both originals and asked whether the extraction
 * matches them -- a question with an answer on the page, unlike "is this a
 * good question".
 *
 * A provider that cannot be reached is not a bad question, so it is reported
 * separately: a rejected question has been judged, a failed one has not, and
 * conflating them buries real content problems under outages.
 */
const REVIEW_INSTRUCTION = `You verify that an exam question was extracted correctly from its source page.

You are given two images -- the question as printed, and the official mark scheme page -- and the extracted record. Decide only whether the extraction is faithful to them. Do not judge whether the question is a good question, and never rewrite it.

Reject when any of these is true:
- the prompt is not what the question image says, or is truncated, or has absorbed a neighbouring question
- the mark total does not match the tariff printed on the question
- the question depends on a figure, table, diagram or extract that neither the prompt nor the question image contains
- the extracted criteria are not what the scheme page awards for this question, or are for a different question
- the criteria do not add up to the tariff
- the question number or label does not match

Return ONLY JSON: {"verdict":"approve"|"reject","confidence":0..1,"issues":[string]}
issues names what is wrong, one short sentence each, and is empty when approving. Be strict: a student is marked against this.`;

export type ExamAiReviewOutcome = {
  questionId: string;
  review: ExamQuestionReview;
};

/** Below this the model is not sure enough to be the only thing checking. */
const MIN_CONFIDENCE = 0.75;

async function renderedAsset(question: ExamQuestion, id: string) {
  const asset = [...(question.reviewAssets ?? []), ...question.assets].find(
    (item) =>
      item.id === id &&
      item.storagePath?.startsWith("internal/examQuestionBank/") &&
      item.mimeType === "image/png"
  );
  if (!asset?.storagePath) return null;
  const [bytes] = await getAdminStorageBucket().file(asset.storagePath).download();
  if (bytes.length > 8 * 1024 * 1024) return null;
  return bytes.toString("base64");
}

/**
 * Both sides of the comparison: the question as printed, and its scheme page.
 *
 * With only the question the reviewer can say whether criteria look plausible
 * for it, which is not the question being asked. Confirming that the criteria
 * reproduce the official scheme needs the official scheme.
 */
async function sourceParts(question: ExamQuestion): Promise<{
  parts: AiContentPart[];
  hasScheme: boolean;
}> {
  const [questionImage, schemeImage] = await Promise.all([
    renderedAsset(question, "question-extract").catch(() => null),
    renderedAsset(question, "scheme-extract").catch(() => null),
  ]);
  if (!questionImage) return { parts: [], hasScheme: false };
  const parts: AiContentPart[] = [
    { text: "The question exactly as printed on the paper:" },
    { inlineData: { mimeType: "image/png", data: questionImage } },
  ];
  if (schemeImage) {
    parts.push({ text: "The official mark scheme page for this question:" });
    parts.push({ inlineData: { mimeType: "image/png", data: schemeImage } });
  }
  return { parts, hasScheme: Boolean(schemeImage) };
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
  const failed = (note: string): ExamAiReviewOutcome => ({
    questionId: question.id,
    review: { status: "review_failed", by: "ai", at: now, notes: [note] },
  });

  if (!secret) return reject("No mark scheme was stored for this question.");
  const criteria = schemeCriteria(secret.markSchemeItem);
  if (criteria.length === 0) return reject("The mark scheme has no awardable criteria.");

  const { parts: pageParts, hasScheme } = await sourceParts(question).catch(() => ({ parts: [], hasScheme: false }));
  // Without the page there is nothing to check the extraction against, and
  // approving on the extraction's own say-so would be reviewing it against
  // itself.
  if (pageParts.length === 0) {
    return reject("The rendered question image is missing, so the extraction cannot be verified.");
  }
  if (!hasScheme) {
    return reject("The official mark scheme page is missing, so the criteria cannot be checked against it.");
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
    return failed("The reviewer could not be reached. Nothing is wrong with the question yet.");
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonObject(response);
  } catch {
    return failed("The reviewer returned an unreadable verdict.");
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
