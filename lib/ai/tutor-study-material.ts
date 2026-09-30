import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import { normalizeAssistantId, normalizeAssistantText } from "@/lib/ai/jami-assistant-normalize";

/**
 * Study material Tutor makes from a conversation: flashcards to review, or a
 * practice set to sit.
 *
 * This used to be reachable only from a source's Create panel, so a student who
 * asked Tutor for flashcards mid-conversation was told to go somewhere else --
 * and the thing they had just worked through was not what got drafted. Tutor
 * now makes them where it is asked, from what was being discussed.
 */
export type TutorStudyMaterialKind = "flashcards" | "practice";

export const TUTOR_STUDY_MATERIAL_KINDS: readonly TutorStudyMaterialKind[] = [
  "flashcards",
  "practice",
];

export const TUTOR_STUDY_MATERIAL_MAX_FOCUS_LENGTH = 240;
export const TUTOR_FLASHCARD_DEFAULT_COUNT = 6;
export const TUTOR_FLASHCARD_MAX_COUNT = 15;
export const TUTOR_PRACTICE_DEFAULT_COUNT = 5;
export const TUTOR_PRACTICE_MAX_COUNT = 10;

/** What the student asked Tutor to make, recorded on the answer that agreed to. */
export type TutorStudyMaterialRequest = {
  kind: TutorStudyMaterialKind;
  /** A few words naming what to make it on, written by Tutor or taken from the request. */
  focus: string;
  /** How many the student asked for, when they said. */
  count?: number;
};

/** What was made, recorded on the answer so a reopened chat still shows it. */
export type TutorStudyMaterialResult =
  | {
      kind: "flashcards";
      draftIds: string[];
      focus: string;
      /** The folder the conversation sits in, for choosing a deck. */
      folderId?: string;
      /** The deck being studied when the request came from a flashcard. */
      deckId?: string;
      createdAt: number;
    }
  | {
      kind: "practice";
      sessionId: string;
      title: string;
      focus: string;
      questionCount: number;
      totalMarks: number;
      createdAt: number;
    };

export function isTutorStudyMaterialKind(value: unknown): value is TutorStudyMaterialKind {
  return value === "flashcards" || value === "practice";
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  couple: 2, few: 4, some: 0,
};

const MAKE_VERBS =
  "make|create|generate|write|give|build|produce|draft|prepare|set|turn|put|do|want|need|get";
/** Flashcards by any name a student uses for them. */
const FLASHCARD_NOUNS = "flash\\s?cards?|revision\\s+cards?|cue\\s?cards?|(?:some|a\\s+few|\\d+|few)\\s+cards";
/**
 * Questions to answer, as a set. "Quiz me" and "ask me a question" are left
 * out on purpose: those are a conversation, and Tutor already runs them.
 */
const PRACTICE_NOUNS =
  "practi[cs]e\\s+(?:questions?|sets?|sessions?|papers?|problems?|qs)|exam(?:[-\\s]style)?\\s+questions|test\\s+questions|questions\\s+(?:to|i\\s+can)\\s+(?:practi[cs]e|do|answer|try)|(?:some|a\\s+few|\\d+|few|more)\\s+(?:exam(?:[-\\s]style)?\\s+)?questions(?:\\s+(?:on|about|for))";

const REQUEST_PATTERN = (nouns: string) =>
  new RegExp(
    `\\b(?:${MAKE_VERBS})\\b[^.?!\\n]{0,60}?\\b(?:${nouns})|\\b(?:${nouns})\\b[^.?!\\n]{0,30}?\\b(?:please|pls|for me|on this|on that|from this|from that)\\b|^\\s*(?:can|could|would|will)\\s+(?:you|u)\\b[^.?!\\n]{0,60}?\\b(?:${nouns})`,
    "i"
  );

const FLASHCARD_REQUEST_PATTERN = REQUEST_PATTERN(FLASHCARD_NOUNS);
const PRACTICE_REQUEST_PATTERN = REQUEST_PATTERN(PRACTICE_NOUNS);
/** A request turned down in the same breath: "don't make flashcards, just explain". */
const DECLINED_PATTERN =
  /\b(?:don'?t|do not|no need to|not|without|instead of|rather than|stop)\b[^.?!\n]{0,25}?\b(?:make|create|generate|give|write|flash\s?cards?|questions?)\b/i;
/** "Ask me some questions on this" is a quiz in the chat, not a set to sit. */
const CONVERSATIONAL_QUIZ_PATTERN = /\b(?:ask|quiz|test)\s+me\b/i;

/**
 * Whether the student has asked Tutor to make flashcards or practice questions.
 *
 * Deterministic, so the ordinary phrasings are never left to a model's reading
 * of the request. The model gets its own say through the answer schema, which
 * catches the wordings this does not.
 */
export function detectTutorStudyMaterialRequest(
  message: string
): TutorStudyMaterialKind | null {
  const text = message.trim();
  if (!text || text.length > 1_200) return null;
  if (DECLINED_PATTERN.test(text)) return null;
  const flashcards = FLASHCARD_REQUEST_PATTERN.exec(text);
  const practice = CONVERSATIONAL_QUIZ_PATTERN.test(text)
    ? null
    : PRACTICE_REQUEST_PATTERN.exec(text);
  if (flashcards && practice) {
    // Asked for both: take whichever was named first; the other is offered.
    return flashcards.index <= practice.index ? "flashcards" : "practice";
  }
  if (flashcards) return "flashcards";
  if (practice) return "practice";
  return null;
}

/**
 * How many the student asked for, bounded to what one request makes.
 *
 * "Make me 10 flashcards", "give me five practice questions". Anything not
 * said, or said outside the range, falls back to the default rather than
 * failing -- a student asking for fifty gets the most one request makes.
 */
export function readTutorStudyMaterialCount(
  message: string,
  kind: TutorStudyMaterialKind
) {
  const [fallback, maximum] =
    kind === "flashcards"
      ? [TUTOR_FLASHCARD_DEFAULT_COUNT, TUTOR_FLASHCARD_MAX_COUNT]
      : [TUTOR_PRACTICE_DEFAULT_COUNT, TUTOR_PRACTICE_MAX_COUNT];
  const noun =
    kind === "flashcards"
      ? "(?:flash\\s?)?cards?"
      : "(?:(?:practi[cs]e|exam(?:[-\\s]style)?|test)\\s+)?(?:questions?|problems?|qs)";
  const match = new RegExp(
    `\\b(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:more\\s+|quick\\s+|short\\s+|hard\\s+|easy\\s+|new\\s+)?${noun}\\b`,
    "i"
  ).exec(message);
  if (!match) return fallback;
  const raw = match[1]!.toLowerCase();
  const value = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? 0;
  if (!value) return fallback;
  return Math.max(kind === "flashcards" ? 2 : 1, Math.min(maximum, value));
}

const SUBSTANTIVE_ANSWER_LENGTH = 260;
const TEACHING_REQUEST_PATTERN =
  /\b(?:explain\w*|help|understand\w*|struggl\w*|confus\w*|how (?:do|does|can|to)|why|what (?:is|are|does)|when (?:do|should|to)|difference|teach|walk me through|stuck|revis\w*)\b/i;
const MARKING_REQUEST_PATTERN = /\b(?:mark|check|grade|review|feedback)\b/i;

/**
 * What Tutor offers to make after an answer.
 *
 * Offered after teaching -- an explanation substantial enough to be worth
 * revising from -- and not after marking, a one-line answer, or a hint on a
 * card whose answer the student has not seen yet. Practice is offered as
 * readily as flashcards: it used to be offered nowhere, so the one kind of
 * practice that is marked was the one Tutor never suggested.
 */
export function getTutorStudyMaterialOffers(input: {
  message: string;
  answer: string;
  context: JamiAssistantContext;
  practiceAvailable: boolean;
  /** Already being made for this answer, so not offered again. */
  requested?: TutorStudyMaterialKind | null;
}): TutorStudyMaterialKind[] {
  if (input.context.surface === "learn" && input.context.phase === "question") return [];
  if (input.context.surface === "notebook" && MARKING_REQUEST_PATTERN.test(input.message)) return [];
  if (input.answer.trim().length < SUBSTANTIVE_ANSWER_LENGTH) return [];
  if (!input.requested && !TEACHING_REQUEST_PATTERN.test(input.message) && input.answer.length < 600) {
    return [];
  }
  return TUTOR_STUDY_MATERIAL_KINDS.filter(
    (kind) => kind !== input.requested && (kind !== "practice" || input.practiceAvailable)
  );
}

/** A focus fit for a label and a prompt: one line, bounded, never empty. */
export function normalizeTutorStudyMaterialFocus(value: unknown, fallback = "") {
  const focus = normalizeAssistantText(
    typeof value === "string" ? value.replace(/\s+/g, " ") : "",
    TUTOR_STUDY_MATERIAL_MAX_FOCUS_LENGTH
  );
  if (focus) return focus;
  return normalizeAssistantText(fallback.replace(/\s+/g, " "), TUTOR_STUDY_MATERIAL_MAX_FOCUS_LENGTH);
}

export function normalizeTutorStudyMaterialRequest(
  value: unknown
): TutorStudyMaterialRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isTutorStudyMaterialKind(record.kind)) return undefined;
  const focus = normalizeTutorStudyMaterialFocus(record.focus);
  if (!focus) return undefined;
  const count =
    typeof record.count === "number" && Number.isFinite(record.count)
      ? Math.max(1, Math.min(TUTOR_FLASHCARD_MAX_COUNT, Math.round(record.count)))
      : undefined;
  return { kind: record.kind, focus, ...(count ? { count } : {}) };
}

export function normalizeTutorStudyMaterialOffers(value: unknown): TutorStudyMaterialKind[] {
  if (!Array.isArray(value)) return [];
  return TUTOR_STUDY_MATERIAL_KINDS.filter((kind) => value.includes(kind));
}

function normalizeCount(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.round(value)))
    : 0;
}

export function normalizeTutorStudyMaterialResult(
  value: unknown
): TutorStudyMaterialResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const focus = normalizeTutorStudyMaterialFocus(record.focus);
  const createdAt = normalizeCount(record.createdAt, Number.MAX_SAFE_INTEGER);
  if (record.kind === "flashcards") {
    const draftIds = Array.isArray(record.draftIds)
      ? Array.from(new Set(record.draftIds.map(normalizeAssistantId).filter(Boolean))).slice(
          0,
          TUTOR_FLASHCARD_MAX_COUNT
        )
      : [];
    if (draftIds.length === 0) return undefined;
    const folderId = normalizeAssistantId(record.folderId);
    const deckId = normalizeAssistantId(record.deckId);
    return {
      kind: "flashcards",
      draftIds,
      focus,
      ...(folderId ? { folderId } : {}),
      ...(deckId ? { deckId } : {}),
      createdAt,
    };
  }
  if (record.kind === "practice") {
    const sessionId = normalizeAssistantId(record.sessionId);
    if (!sessionId) return undefined;
    return {
      kind: "practice",
      sessionId,
      title: normalizeAssistantText(record.title, 160) || "Practice set",
      focus,
      questionCount: normalizeCount(record.questionCount, 100),
      totalMarks: normalizeCount(record.totalMarks, 1_000),
      createdAt,
    };
  }
  return undefined;
}

/** Results keyed by kind, as stored on an answer. */
export function normalizeTutorStudyMaterialResults(
  value: unknown
): Partial<Record<TutorStudyMaterialKind, TutorStudyMaterialResult>> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const results: Partial<Record<TutorStudyMaterialKind, TutorStudyMaterialResult>> = {};
  for (const kind of TUTOR_STUDY_MATERIAL_KINDS) {
    const result = normalizeTutorStudyMaterialResult(record[kind]);
    if (result && result.kind === kind) results[kind] = result;
  }
  return results;
}

/**
 * What Tutor is told about making study material.
 *
 * Tutor used to know nothing about this at all, so asked for flashcards it
 * improvised -- usually by saying it could not, and sending the student to
 * Sources. It is now told that the app makes them, and that its part is to say
 * so in a sentence and name what they will be on.
 */
export function buildTutorStudyMaterialInstruction(input: {
  requested: TutorStudyMaterialKind | null;
  practiceAvailable: boolean;
}) {
  const practiceLine = input.practiceAvailable
    ? "Jami can also make a marked practice set: exam-style questions the student answers and Jami marks, saved in Practice so they can start it now or later."
    : "Practice sets are not available in this deployment, so if the student asks for practice questions, ask them in the chat instead.";
  const general = `Jami can make flashcards from any conversation, whatever the student is studying: they appear under your reply for the student to accept. ${practiceLine} Never tell the student you cannot make flashcards${input.practiceAvailable ? " or practice questions" : ""}, and never send them to Sources or another page to do it. When the student's CURRENT request asks you to make flashcards${input.practiceAvailable ? " or a practice set" : ""}, set studyMaterial to ${input.practiceAvailable ? '"flashcards" or "practice"' : '"flashcards"'}; otherwise set it to "none". Always fill studyMaterialFocus with what this answer is about, as a short, specific topic phrase from the conversation -- such as "separating variables: which side to divide" -- never a sentence addressed to the student, and naming the particular part the student asked to focus on when they said. When studyMaterial is set, the answer is one or two short sentences saying what you are making them on; do not write the flashcards or questions out yourself.`;
  if (!input.requested) return general;
  const noun = input.requested === "flashcards" ? "flashcards" : "a practice set";
  return `${general}\nThe student has asked for ${noun}. Set studyMaterial to "${input.requested}".`;
}

/**
 * The student's request and Tutor's reading of it, reconciled.
 *
 * The deterministic reading wins where it found one, because that is what the
 * student typed. Tutor's own reading counts when the wording was one the
 * pattern missed, and its focus is preferred either way: it has read the
 * conversation, and the request itself is often just "make me flashcards".
 */
export function resolveTutorStudyMaterialRequest(input: {
  detected: TutorStudyMaterialKind | null;
  modelKind: TutorStudyMaterialKind | null;
  modelFocus: string;
  message: string;
  practiceAvailable: boolean;
}): TutorStudyMaterialRequest | null {
  const kind = input.detected ?? input.modelKind;
  if (!kind || (kind === "practice" && !input.practiceAvailable)) return null;
  const focus = normalizeTutorStudyMaterialFocus(input.modelFocus, input.message);
  if (!focus) return null;
  return { kind, focus, count: readTutorStudyMaterialCount(input.message, kind) };
}
