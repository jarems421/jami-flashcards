import "server-only";

import { extractJsonArray } from "@/lib/ai/model-json";
import { generateAiText } from "@/lib/ai/provider-router";
import {
  buildPracticeRequest,
  practiceGenerationPrompt,
  readPracticeDrafts,
  type PracticeDraftRejection,
  type PracticeInterventionRequest,
  type PracticeQuestionDraft,
  type PracticeRequestRejection,
} from "@/lib/learning/interventions/practice-request";
import type { PracticePaperQuestion } from "@/lib/practice/practice-papers";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger({ route: "learning.practice_intervention" });

const GENERATION_TIMEOUT_MS = 45_000;

/**
 * The shape the answer must take.
 *
 * A MIME type alone was not enough. Asked for questions with per-point marks,
 * the model returned excellent questions whose points were plain strings with
 * the tariff written inside them -- "Substitutes x = 0 to get f(0) = 5 (B1)".
 * Every question was usable and every one was rejected, because reading a mark
 * out of that string would mean inferring it, which is the guessing this whole
 * path exists to avoid.
 *
 * So the shape is declared rather than described. Spelled with plain strings
 * because only `lib/ai/gemini.ts` may import the provider SDK; these are the
 * enum's own values.
 */
const PRACTICE_RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      prompt: { type: "STRING", description: "The question as a student would read it." },
      marks: { type: "INTEGER", description: "What the question is worth." },
      answer: { type: "STRING", description: "A full worked answer." },
      points: {
        type: "ARRAY",
        description:
          "One entry per award. Put the marks in the `marks` field, never inside the text.",
        items: {
          type: "OBJECT",
          properties: {
            marks: { type: "INTEGER", description: "Marks this point awards." },
            text: { type: "STRING", description: "What earns it." },
          },
          required: ["marks", "text"],
        },
      },
    },
    required: ["prompt", "marks", "answer", "points"],
  },
} as const;

export type PracticeInterventionFailure =
  | PracticeRequestRejection
  | PracticeDraftRejection
  | "generation_failed";

export type PracticeInterventionResult =
  | {
      ok: true;
      /** For the student to read before anything is stored. */
      questions: PracticeQuestionDraft[];
      request: PracticeInterventionRequest;
      dropped: number;
    }
  | { ok: false; reason: PracticeInterventionFailure };

/**
 * Write targeted practice questions for one concept.
 *
 * A draft, like the flashcard generator: nothing is stored, and the
 * intervention is not completed by generating. Questions become evidence only
 * when a student sits them and they are marked -- which is the whole reason
 * each one has to arrive with a scheme capable of marking it.
 */
export async function generateInterventionPractice(input: {
  conceptId: string;
  conceptLabel: string;
  specificationId: string;
  interventionId: string;
  requestedCount?: number;
}): Promise<PracticeInterventionResult> {
  const prepared = buildPracticeRequest({
    conceptId: input.conceptId,
    conceptLabel: input.conceptLabel,
    specificationId: input.specificationId,
    interventionId: input.interventionId,
    ...(input.requestedCount !== undefined ? { requestedCount: input.requestedCount } : {}),
  });
  if (!prepared.ok) {
    log.warn("request.refused", { reason: prepared.reason });
    return { ok: false, reason: prepared.reason };
  }

  let raw = "";
  try {
    const result = await generateAiText({
      role: "worker",
      routeReason: "routine",
      request: {
        systemInstruction:
          "You write exam-style practice questions for a student revising to a published course " +
          "specification. Answer with a JSON array of objects, each with `prompt`, `marks`, " +
          "`answer` and `points`, and nothing else.",
        contents: [
          { role: "user", parts: [{ text: practiceGenerationPrompt(prepared.request) }] },
        ],
      },
      timeoutMs: GENERATION_TIMEOUT_MS,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: PRACTICE_RESPONSE_SCHEMA,
      },
    });
    raw = typeof result === "string" ? result : (result as { text?: string }).text ?? "";
  } catch (error) {
    // The intervention stays open: Jami asked for questions and produced none.
    log.warn("generation.failed", { error });
    return { ok: false, reason: "generation_failed" };
  }

  /*
   * A bounded sample of what came back, on rejection only.
   *
   * "Rejected" is not a diagnosis: a model that returned prose, one that
   * returned questions with no scheme, and one whose schemes never add up all
   * look identical from the reason alone, and they need different fixes. This
   * is generated content rather than anything a student wrote, so there is
   * nothing here that should not be in a log.
   */
  const sample = raw.slice(0, 600);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(extractJsonArray(raw));
  } catch {
    log.warn("drafts.rejected", { reason: "no_usable_questions", stage: "parse", sample });
    return { ok: false, reason: "no_usable_questions" };
  }

  const read = readPracticeDrafts(parsed);
  if (!read.ok) {
    log.warn("drafts.rejected", { reason: read.reason, stage: "validate", sample });
    return { ok: false, reason: read.reason };
  }

  log.info("drafts.ready", { questions: read.questions.length, dropped: read.dropped });
  return {
    ok: true,
    questions: read.questions,
    request: prepared.request,
    dropped: read.dropped,
  };
}

/**
 * The drafts as the stored shapes, once the student has agreed to them.
 *
 * Produces exactly what the existing practice pipeline already reads, so a
 * question generated by an intervention is sat, marked and turned into
 * evidence by the same code as any other -- there is no second marking path
 * and no second kind of practice question.
 *
 * The concept is attached here rather than inferred afterwards, which is what
 * makes the resulting attempts land on the right concept in the profile: see
 * `practicePaperObservations`.
 */
export function practiceToStore(
  questions: readonly PracticeQuestionDraft[],
  request: Pick<PracticeInterventionRequest, "conceptId" | "interventionId">
): { questions: PracticePaperQuestion[]; markScheme: PracticePaperMarkSchemeItem[] } {
  const stored: PracticePaperQuestion[] = [];
  const markScheme: PracticePaperMarkSchemeItem[] = [];

  questions.forEach((question, index) => {
    const id = `q${index + 1}`;
    stored.push({
      id,
      label: `Question ${index + 1}`,
      prompt: question.prompt,
      marks: question.marks,
      assets: [],
      conceptIds: [request.conceptId],
    });
    markScheme.push({
      questionId: id,
      maxMarks: question.marks,
      answer: question.answer,
      acceptableAlternatives: [],
      commonMistakes: [],
      marking: "additive",
      points: question.points.map((point, pointIndex) => ({
        id: `${id}.${pointIndex + 1}`,
        marks: point.marks,
        code: "B",
        text: point.text,
        dep: [],
        ft: false,
        essentialTerms: [],
        allow: [],
        reject: [],
      })),
    });
  });

  return { questions: stored, markScheme };
}
