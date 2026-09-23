import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { resolveAiProviderPolicy } from "@/lib/ai/provider-policy";
import { generateAiText } from "@/lib/ai/provider-router";
import type { PracticePaper } from "@/lib/practice/practice-papers";
import {
  AI_PAPER_REVIEWER_PREFIX,
  combinePaperReview,
  deterministicPaperFindings,
  isAiPaperReviewer,
  readAiPaperReview,
} from "@/lib/practice/paper-review";
import {
  getPaperGenerationBenchmarkRun,
  loadPaperGenerationBenchmarkArtifact,
  loadPaperGenerationBenchmarkAsset,
  reviewPaperGenerationBenchmarkCase,
} from "@/services/ai/paper-generation-benchmark.server";
import { parseJsonObject } from "@/services/ai/practice-paper-generation.server";

/**
 * A benchmark paper reviewed by a model instead of a person.
 *
 * Every paper in a benchmark run needs a review before the run can be
 * approved, and 108 of them is more reading than one owner will do well. So a
 * model reads each one against the same rubric a person uses, writes the same
 * review record, and signs it `ai:<model>` so it can always be told apart. A
 * person's review is never replaced by one of these; a person can replace
 * one of these at any time.
 *
 * The reviewer is Gemini, deliberately a different family from the models
 * that write the papers, so a paper is not graded by the thing that wrote it.
 * Arithmetic -- totals, missing schemes, a scheme about another question, a
 * figure that failed validation -- is checked by code first and cannot be
 * argued away.
 */

const REVIEW_INSTRUCTION = `You review a generated practice exam paper before any student sees it, as an experienced examiner and teacher of this subject would. You did not write it.

Score each dimension from 1 to 5, where 5 is as good as a real paper from this board, 4 has minor issues a teacher would accept, 3 has noticeable problems, 2 has serious problems and 1 is unusable:
- authenticity: reads like the named board's real paper for this component -- command words, structure, style and conventions.
- levelFit: the demand matches the qualification and tier stated.
- schemeCorrectness: every mark scheme item is right, awards exactly the marks the question carries, and would let two markers agree.
- specificationCoverage: every question is within the specification, and together they cover it sensibly for this component.
- timing: answerable in the stated time; the marks per minute are realistic.
- visualQuality: every figure, table and graph is correct, legible and matches its question.
- accessibility: wording is clear and unambiguous, with no reading load the question does not need.
- originality: not copied from a real paper, and the questions are not repetitive.

Hard blockers. Report one only with direct evidence from the paper; any one makes the paper unusable:
- unanswerable_question: a question cannot be answered as written -- missing data, contradictory or impossible values, or it refers to something that is not there.
- incorrect_scheme: a mark scheme item is wrong, so a student marked against it would get the wrong result. Work each answer yourself and compare it with the scheme before deciding.
- invalid_total: question marks, scheme marks or the paper total do not add up.
- answer_leak: a question, figure or instruction gives away an answer it asks for.
- missing_insert: the paper refers to an insert, source, extract, formula sheet or figure that is not included.
- broken_visual: a figure, table or graph is wrong, unreadable or does not match its question.
- confirmed_copying: a question is reproduced from a real published paper, recognisably and nearly word for word.
- privacy_failure: the paper contains personal information about a real person or a student.
- ownership_failure: the paper reproduces material it plainly had no right to use.

For each blocker give the questionId from the paper, or null when it is about the whole paper, and evidence quoting the words that show it. Do not reward length. Be strict: a student will be marked against this paper.

Return ONLY JSON:
{"usable":true|false,"scores":{"authenticity":1-5,"levelFit":1-5,"schemeCorrectness":1-5,"specificationCoverage":1-5,"timing":1-5,"visualQuality":1-5,"accessibility":1-5,"originality":1-5},"blockers":[{"code":"...","questionId":"..."|null,"evidence":"..."}],"comments":"two or three sentences a teacher would write"}`;

/** Figures sent with one review. Beyond this a paper is sent as text alone and says so. */
const MAX_FIGURES = 16;
const REVIEW_TIMEOUT_MS = 180_000;

export type PaperAiReviewOutcome =
  | { caseId: string; status: "reviewed"; usable: boolean; blockers: string[] }
  | { caseId: string; status: "kept_person_review" | "not_ready" | "failed"; reason: string };

export function paperReviewerId() {
  return `${AI_PAPER_REVIEWER_PREFIX}${resolveAiProviderPolicy(process.env).capabilities.documentVision.modelId}`;
}

type ArtifactPaper = PracticePaper & { questions: (PracticePaper["questions"][number] & { assets: { id: string; previewUrl?: string }[] })[] };

async function figureParts(runId: string, caseId: string, paper: ArtifactPaper) {
  const parts: AiContentPart[] = [];
  let omitted = 0;
  for (const question of paper.questions) {
    for (const asset of question.assets ?? []) {
      if (!asset.previewUrl) continue;
      if (parts.length >= MAX_FIGURES * 2) {
        omitted += 1;
        continue;
      }
      const loaded = await loadPaperGenerationBenchmarkAsset(runId, caseId, asset.id).catch(() => null);
      if (!loaded) continue;
      parts.push({ text: `Figure ${asset.id} for question ${question.id}:` });
      parts.push({ inlineData: { mimeType: loaded.mimeType, data: loaded.bytes.toString("base64") } });
    }
  }
  return { parts, omitted };
}

/** The paper as a reviewer reads it: everything a student sees, and the scheme they are marked against. */
function paperText(artifact: Record<string, unknown>, paper: ArtifactPaper, omittedFigures: number) {
  const profile = artifact.profile && typeof artifact.profile === "object" ? artifact.profile : {};
  return JSON.stringify(
    {
      examFormat: profile,
      title: paper.title,
      durationMinutes: paper.durationMinutes,
      totalMarks: paper.totalMarks,
      instructions: paper.instructions,
      assessmentProfile: paper.assessmentProfile,
      companionDocuments: paper.companionDocuments,
      choiceGroups: paper.choiceGroups,
      questions: paper.questions.map((question) => ({
        id: question.id,
        label: question.label,
        section: question.section,
        marks: question.marks,
        prompt: question.prompt,
        figures: (question.assets ?? []).map((asset) => {
          const visible: Record<string, unknown> = { ...asset };
          delete visible.previewUrl;
          return visible;
        }),
      })),
      markScheme: paper.markScheme,
      ...(omittedFigures > 0 ? { note: `${omittedFigures} figures were not attached; judge them from their descriptions.` } : {}),
    },
    null,
    1
  );
}

export async function reviewPaperBenchmarkCaseWithAi(input: {
  runId: string;
  caseId: string;
}): Promise<PaperAiReviewOutcome> {
  const { runId, caseId } = input;
  const artifact = await loadPaperGenerationBenchmarkArtifact(runId, caseId).catch(() => null);
  const paper = artifact?.paper as ArtifactPaper | undefined;
  if (!artifact || !paper || !Array.isArray(paper.questions) || paper.questions.length === 0) {
    return { caseId, status: "not_ready", reason: "No generated paper to review." };
  }

  const figures = await figureParts(runId, caseId, paper);
  let response: string;
  try {
    response = await generateAiText({
      role: "documentVision",
      taskClass: "visual",
      timeoutMs: REVIEW_TIMEOUT_MS,
      deadlineAt: Date.now() + REVIEW_TIMEOUT_MS + 15_000,
      generationConfig: { temperature: 0, topP: 0.6, maxOutputTokens: 6_000 },
      request: {
        systemInstruction: REVIEW_INSTRUCTION,
        contents: [
          {
            role: "user",
            parts: [...figures.parts, { text: `The paper:\n${paperText(artifact, paper, figures.omitted)}` }],
          },
        ],
      },
    });
  } catch (error) {
    return { caseId, status: "failed", reason: error instanceof Error ? error.message : "The reviewer could not be reached." };
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonObject(response);
  } catch {
    return { caseId, status: "failed", reason: "The reviewer returned an unreadable verdict." };
  }
  const ai = readAiPaperReview(payload, new Set(paper.questions.map((question) => question.id)));
  if (!ai) return { caseId, status: "failed", reason: "The reviewer's scores could not be read." };

  const combined = combinePaperReview(ai, deterministicPaperFindings(paper));
  const saved = await reviewPaperGenerationBenchmarkCase({
    reviewerUid: paperReviewerId(),
    runId,
    caseId,
    usable: combined.usable,
    scores: combined.scores,
    blockers: combined.blockers,
    comments: combined.comments,
    keepPersonReview: true,
  });
  if (!isAiPaperReviewer(saved.reviewerUid)) {
    return { caseId, status: "kept_person_review", reason: "A person reviewed this paper first." };
  }
  return { caseId, status: "reviewed", usable: saved.usable, blockers: saved.blockers };
}

/**
 * Review every ready paper in a run that nobody has reviewed yet.
 *
 * `redoAi` also re-reviews papers an earlier AI review covered, for a new
 * reviewer model; a person's review is left alone either way.
 */
export async function reviewPaperBenchmarkRunWithAi(input: {
  runId: string;
  limit?: number;
  redoAi?: boolean;
  onOutcome?: (outcome: PaperAiReviewOutcome) => void;
}) {
  const detail = await getPaperGenerationBenchmarkRun(input.runId);
  if (!detail) throw new Error("Benchmark run not found.");
  const pending = detail.cases.filter(
    (item) =>
      item.status === "ready" &&
      (!item.review || (input.redoAi === true && isAiPaperReviewer(item.review.reviewerUid)))
  );
  const chosen = input.limit ? pending.slice(0, input.limit) : pending;
  const outcomes: PaperAiReviewOutcome[] = [];
  for (const item of chosen) {
    const outcome = await reviewPaperBenchmarkCaseWithAi({ runId: input.runId, caseId: item.id });
    outcomes.push(outcome);
    input.onOutcome?.(outcome);
  }
  return { pending: pending.length, outcomes };
}
