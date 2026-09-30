import { longestCopiedRun } from "@/lib/ai/source-evidence";
import { MAX_CARD_COPIED_RUN_WORDS } from "@/lib/ai/tutor-card-suggestions";
import {
  MAX_QUESTION_MARKS,
  readPracticeDrafts,
  type PracticeQuestionDraft,
} from "@/lib/learning/interventions/practice-question-shape";

/**
 * Practice questions Tutor suggests in a conversation.
 *
 * The same contract as suggested flashcards: an offer only, saved as a draft
 * in its source's review queue, and approved there into a notebook page to be
 * worked. What a question adds is a mark scheme. A question with nothing to
 * mark it against cannot tell anyone how the student did, so each one carries
 * the points a marker would award, and the same rule the engine's own writer
 * uses decides whether it is markable at all: the points must add up to the
 * tariff, or the question has been described rather than written.
 */

export const MAX_TUTOR_QUESTION_SUGGESTIONS = 5;
const MAX_POINTS = 12;
const MAX_POINT_TEXT = 300;
const MAX_PROMPT_LENGTH = 1_200;
const MAX_ANSWER_LENGTH = 1_500;

export type TutorQuestionSuggestion = PracticeQuestionDraft & {
  /** The S-reference the question draws on most. */
  sourceRef: string;
};

export type JamiAssistantSuggestedQuestion = PracticeQuestionDraft & {
  sourceId: string;
  sourceTitle: string;
  topicIds: string[];
};

/*
 * Asking to be set questions, as opposed to asking one. "I have a question
 * about osmosis" is the second and must not come back with a worksheet.
 */
const QUESTION_REQUEST_PATTERN =
  /\b(?:practi[cs]e (?:questions?|problems?)|exam(?:[- ]style)? questions?|past[- ]paper(?:[- ]style)? questions?|test me|quiz me|(?:make|create|write|draft|generate|suggest|set|give)(?: me)?(?: some| a few| an?| \d+)?(?: more)? (?:practi[cs]e |exam(?:[- ]style)? |extra )?questions?)\b/i;

/**
 * Whether this turn may carry question suggestions.
 *
 * Decided before the model is asked, like cards and marking. Questions need a
 * source to be saved against, because drafts are reviewed per source.
 */
export function invitesTutorQuestionSuggestions(input: {
  message: string;
  readableSourceCount: number;
}) {
  return input.readableSourceCount > 0 && QUESTION_REQUEST_PATTERN.test(input.message);
}

export const TUTOR_QUESTION_INSTRUCTION = [
  "The student wants practice questions. Put them in the \"questions\" field, two to four unless",
  "they asked for a number, never more than five. Each question practises using one idea the way",
  "an exam asks for it -- explain, calculate, compare, evaluate, apply -- rather than recalling a",
  `definition. Give the prompt, the marks it is worth (1 to ${MAX_QUESTION_MARKS}), a full model answer,`,
  "and one mark-scheme point per mark in the order marks are earned; the points' marks must add up",
  "exactly to the question's marks, or the question is thrown away. Write every question yourself:",
  "never copy a question or a sentence from a source, including a past paper. Use each source's own",
  "notation and level. Set each question's sourceRef to the S-reference it draws on most. In the",
  "answer, say in a sentence or two what the questions practise; do not repeat the questions there",
  "or give away their answers.",
].join(" ");

/**
 * The model's questions, kept only where they are usable.
 *
 * Dropped rather than repaired, as cards are: a question whose scheme does not
 * account for its marks, one citing a source this request never read, a
 * duplicate, or one lifted from its source is not worth offering.
 */
export function readTutorQuestionSuggestions(
  value: unknown,
  input: {
    allowedSourceRefs: readonly string[];
    evidenceBySourceRef?: ReadonlyMap<string, readonly string[]>;
  }
): TutorQuestionSuggestion[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(input.allowedSourceRefs);
  const prompts = new Set<string>();
  const questions: TutorQuestionSuggestion[] = [];
  for (const candidate of value) {
    if (questions.length >= MAX_TUTOR_QUESTION_SUGGESTIONS) break;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const sourceRef =
      typeof (candidate as Record<string, unknown>).sourceRef === "string"
        ? ((candidate as Record<string, unknown>).sourceRef as string).trim()
        : "";
    if (!allowed.has(sourceRef)) continue;
    // The engine's own test of a markable question, one candidate at a time.
    const checked = readPracticeDrafts([candidate]);
    if (!checked.ok) continue;
    const [question] = checked.questions;
    if (!question) continue;
    const key = question.prompt.toLowerCase().replace(/\s+/g, " ");
    if (prompts.has(key)) continue;
    const evidence = input.evidenceBySourceRef?.get(sourceRef) ?? [];
    if (
      evidence.length > 0 &&
      longestCopiedRun(`${question.prompt}\n${question.answer}`, evidence) > MAX_CARD_COPIED_RUN_WORDS
    ) {
      continue;
    }
    prompts.add(key);
    questions.push({ ...question, sourceRef });
  }
  return questions;
}

function readText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Suggested questions read back from a response or a saved message. */
export function normalizeSuggestedQuestions(value: unknown): JamiAssistantSuggestedQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate): JamiAssistantSuggestedQuestion[] => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const item = candidate as Record<string, unknown>;
      const prompt = readText(item.prompt, MAX_PROMPT_LENGTH);
      const answer = readText(item.answer, MAX_ANSWER_LENGTH);
      const sourceId = readText(item.sourceId, 160);
      const marks =
        typeof item.marks === "number" && Number.isFinite(item.marks) ? Math.round(item.marks) : 0;
      const points = Array.isArray(item.points)
        ? item.points.slice(0, MAX_POINTS).flatMap((point) => {
            if (!point || typeof point !== "object") return [];
            const record = point as Record<string, unknown>;
            const text = readText(record.text, MAX_POINT_TEXT);
            const pointMarks =
              typeof record.marks === "number" && Number.isFinite(record.marks)
                ? Math.round(record.marks)
                : 0;
            return text && pointMarks >= 1 ? [{ marks: pointMarks, text }] : [];
          })
        : [];
      const schemeTotal = points.reduce((total, point) => total + point.marks, 0);
      if (!prompt || !answer || !sourceId || marks < 1 || marks > MAX_QUESTION_MARKS || schemeTotal !== marks) {
        return [];
      }
      const topicIds = Array.isArray(item.topicIds)
        ? Array.from(
            new Set(
              item.topicIds
                .filter((id): id is string => typeof id === "string")
                .map((id) => id.trim().slice(0, 120))
                .filter(Boolean)
            )
          ).slice(0, 20)
        : [];
      return [
        {
          prompt,
          marks,
          answer,
          points,
          sourceId,
          sourceTitle: readText(item.sourceTitle, 160) || "Source",
          topicIds,
        },
      ];
    })
    .slice(0, MAX_TUTOR_QUESTION_SUGGESTIONS);
}

export function markWord(marks: number) {
  return `${marks} ${marks === 1 ? "mark" : "marks"}`;
}

/**
 * A suggested question in the shape a practice-question draft stores.
 *
 * The tariff travels with the prompt, as a paper prints it. The scheme goes
 * beside the model answer rather than into it, so a student checking their
 * work reads what earns each mark and not only what a full answer says.
 */
export function practiceQuestionDraftFields(question: Pick<PracticeQuestionDraft, "prompt" | "marks" | "answer" | "points">) {
  return {
    questionText: `${question.prompt} [${markWord(question.marks)}]`,
    answerText: question.answer,
    solutionText: [
      `Mark scheme (${markWord(question.marks)}):`,
      ...question.points.map((point) => `- ${point.text} (${markWord(point.marks)})`),
    ].join("\n"),
  };
}
