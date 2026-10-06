import type {
  JamiAssistantFollowUp,
  JamiAssistantResponseDepth,
} from "@/lib/ai/jami-assistant";
import {
  isTutorStudyMaterialKind,
  type TutorStudyMaterialKind,
} from "@/lib/ai/tutor-study-material";

/**
 * The next steps Tutor may suggest under an answer.
 *
 * "Explain more" used to sit under every answer that was not already long, and
 * "Make flashcards" and "Practice questions" under nearly every other one --
 * chosen by word patterns and answer length, so a one-line question about a
 * date got the same three buttons as a lesson on enzyme kinetics. Tutor now
 * chooses them from what it actually taught. "Explain more" is gone: a student
 * who wants more says so.
 *
 * Tutor's choice can only narrow what is shown, never widen it: flashcards and
 * practice are offered only where `getTutorStudyMaterialOffers` already allows
 * them, so a hint on an unflipped card or a marked page never gets one.
 */
export type TutorSuggestion = "steps" | TutorStudyMaterialKind;

const TUTOR_SUGGESTIONS: readonly TutorSuggestion[] = ["steps", "flashcards", "practice"];

const SHOW_STEPS: JamiAssistantFollowUp = {
  label: "Show steps",
  prompt: "Show me the steps.",
};

const SUGGESTION_NAMES: Record<TutorSuggestion, string> = {
  steps: "to show the steps",
  flashcards: "flashcards",
  practice: "practice questions",
};

export function getTutorSuggestionKinds(practiceAvailable: boolean): TutorSuggestion[] {
  return TUTOR_SUGGESTIONS.filter((kind) => kind !== "practice" || practiceAvailable);
}

/** Tutor's choices, read leniently: anything unrecognised is dropped, and so is a repeat. */
export function readTutorSuggestions(value: unknown): TutorSuggestion[] {
  if (!Array.isArray(value)) return [];
  return TUTOR_SUGGESTIONS.filter((kind) => value.includes(kind));
}

/**
 * What an earlier answer offered, from what was saved with it.
 *
 * Read from the buttons themselves rather than a stored choice, so answers saved
 * before Tutor chose still count.
 */
export function readSavedTutorSuggestions(message: {
  followUps?: readonly JamiAssistantFollowUp[];
  studyMaterialOffers?: readonly TutorStudyMaterialKind[];
}): TutorSuggestion[] {
  const steps = (message.followUps ?? []).some((followUp) => followUp.prompt === SHOW_STEPS.prompt);
  return [...(steps ? (["steps"] as const) : []), ...(message.studyMaterialOffers ?? [])];
}

export function buildTutorSuggestionInstruction(input: {
  practiceAvailable: boolean;
  /** What Tutor's previous answer in this chat offered. */
  previous?: readonly TutorSuggestion[];
}) {
  const previous = (input.previous ?? []).filter(
    (kind) => kind !== "practice" || input.practiceAvailable
  );
  return [
    "Under your answer the app can show buttons for next steps, listed in suggestions.",
    '"flashcards": when you have taught or explained something the student will need to remember later, such as key facts, terms, definitions, formulas or the stages of a process.',
    input.practiceAvailable
      ? '"practice": when you have taught or explained a method, skill or concept the student would benefit from testing themselves on with exam-style questions.'
      : "",
    input.practiceAvailable
      ? "Suggest both when both fit, such as after teaching a topic with facts to learn and a method to apply."
      : "",
    '"steps": only when you gave a result or method without the working the student needs to reproduce it.',
    "Leave suggestions empty when nothing would help: after a quick factual answer, a yes or no, a check or marking of their work, a hint, small talk, or when the student is already making or doing the thing.",
    previous.length > 0
      ? `Your previous answer in this chat already offered ${previous.map((kind) => SUGGESTION_NAMES[kind]).join(" and ")}; offer the same again only if this answer teaches something new that is worth it.`
      : "",
    "Never write offers like these into the answer, and never end it with a list of things you could do next.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The buttons an answer gets: those Tutor suggested that are allowed here. */
export function resolveTutorSuggestions(input: {
  suggestions: readonly TutorSuggestion[];
  depth: JamiAssistantResponseDepth;
  /** The study material this answer may offer to make at all. */
  allowedMaterial: readonly TutorStudyMaterialKind[];
}): { followUps: JamiAssistantFollowUp[]; studyMaterialOffers: TutorStudyMaterialKind[] } {
  // A detailed answer was asked for in full, working and all.
  const followUps = input.depth !== "detailed" && input.suggestions.includes("steps") ? [SHOW_STEPS] : [];
  const studyMaterialOffers = input.suggestions.filter(
    (suggestion): suggestion is TutorStudyMaterialKind =>
      isTutorStudyMaterialKind(suggestion) && input.allowedMaterial.includes(suggestion)
  );
  return { followUps, studyMaterialOffers };
}
