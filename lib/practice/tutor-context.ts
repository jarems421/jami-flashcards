import type { Attempt, Question } from "@/lib/practice/questions";
import type { Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";

export const PRACTICE_TUTOR_HISTORY_LIMIT = 6;
export const PRACTICE_ATTEMPT_HISTORY_LIMIT = 5;

export type PracticeTutorIntent =
  | "hint"
  | "check-working"
  | "explain-concept"
  | "show-method"
  | "full-solution"
  | "make-flashcard"
  | "similar-question"
  | "stuck-here";

export type TutorContextPacket = {
  question: {
    id: string;
    text: string;
    expectedAnswer?: string;
    solutionNotes?: string;
    topicIds: string[];
    topicNames: string[];
    sourceIds: string[];
    sourceTitles: string[];
  };
  studentState: {
    typedAnswer?: string;
    typedWorking?: string;
    selectedWorkingText?: string;
    scratchpad?: {
      hasDrawing: boolean;
      strokeCount: number;
      note?: string;
      imageAttached: false;
    };
    confidence?: number;
    mistakeLabels?: string[];
  };
  attemptHistory: Array<{
    answer?: string;
    workingText?: string;
    correct: boolean;
    confidence: number;
    mistakeLabels: string[];
    createdAt: number;
  }>;
  tutorHistory: Array<{
    role: "user" | "model";
    text: string;
    intent?: string;
  }>;
  intent: PracticeTutorIntent;
  privacy: {
    sendsUnsavedWorking: boolean;
    persistsUnsavedWorking: false;
  };
};

type TutorMessageInput = {
  role: "user" | "model";
  text: string;
  intent?: string;
};

export function isPracticeTutorIntent(value: unknown): value is PracticeTutorIntent {
  return (
    value === "hint" ||
    value === "check-working" ||
    value === "explain-concept" ||
    value === "show-method" ||
    value === "full-solution" ||
    value === "make-flashcard" ||
    value === "similar-question" ||
    value === "stuck-here"
  );
}

function cleanOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}

function cleanMistakeLabels(value: string | string[] | undefined) {
  if (Array.isArray(value)) return cleanStringArray(value, 8, 80);
  return cleanStringArray(
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [],
    8,
    80
  );
}

function cleanConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function buildTutorContextPacket(input: {
  question: Question;
  topics: Topic[];
  sources: Source[];
  attempts: Attempt[];
  tutorMessages: TutorMessageInput[];
  intent: PracticeTutorIntent;
  typedAnswer?: string;
  typedWorking?: string;
  selectedWorkingText?: string;
  scratchpad?: {
    hasDrawing?: boolean;
    strokeCount?: number;
    note?: string;
  };
  confidence?: number;
  mistakeLabels?: string | string[];
}): TutorContextPacket {
  const topicNames = input.question.topicIds
    .map((topicId) => input.topics.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
  const sourceIds = input.question.sourceIds ?? [];
  const sourceTitles = sourceIds
    .map((sourceId) => input.sources.find((source) => source.id === sourceId)?.title)
    .filter((title): title is string => Boolean(title));
  const typedAnswer = cleanOptionalText(input.typedAnswer, 3_000);
  const typedWorking = cleanOptionalText(input.typedWorking, 3_000);
  const selectedWorkingText = cleanOptionalText(input.selectedWorkingText, 1_500);
  const scratchpadNote = cleanOptionalText(input.scratchpad?.note, 1_500);
  const scratchpadHasDrawing = input.scratchpad?.hasDrawing === true;
  const scratchpadStrokeCount =
    typeof input.scratchpad?.strokeCount === "number" && Number.isFinite(input.scratchpad.strokeCount)
      ? Math.max(0, Math.round(input.scratchpad.strokeCount))
      : 0;
  const confidence = cleanConfidence(input.confidence);
  const mistakeLabels = cleanMistakeLabels(input.mistakeLabels);

  return {
    question: {
      id: input.question.id,
      text: input.question.questionText,
      expectedAnswer: cleanOptionalText(input.question.answerText, 2_000),
      solutionNotes: cleanOptionalText(input.question.solutionText, 4_000),
      topicIds: input.question.topicIds.slice(0, 20),
      topicNames: topicNames.slice(0, 8),
      sourceIds: sourceIds.slice(0, 20),
      sourceTitles: sourceTitles.slice(0, 8),
    },
    studentState: {
      typedAnswer,
      typedWorking,
      selectedWorkingText,
      scratchpad:
        scratchpadHasDrawing || scratchpadNote
          ? {
              hasDrawing: scratchpadHasDrawing,
              strokeCount: scratchpadStrokeCount,
              note: scratchpadNote,
              imageAttached: false,
            }
          : undefined,
      confidence,
      mistakeLabels,
    },
    attemptHistory: input.attempts
      .filter((attempt) => attempt.questionId === input.question.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, PRACTICE_ATTEMPT_HISTORY_LIMIT)
      .map((attempt) => ({
        answer: cleanOptionalText(attempt.userAnswer, 1_500),
        workingText: cleanOptionalText(attempt.workingText, 1_500),
        correct: attempt.isCorrect,
        confidence: attempt.confidence,
        mistakeLabels: attempt.mistakeLabels.slice(0, 8),
        createdAt: attempt.createdAt,
      })),
    tutorHistory: input.tutorMessages
      .slice(-PRACTICE_TUTOR_HISTORY_LIMIT)
      .map((message) => ({
        role: message.role,
        text: message.text.slice(0, 1_500),
        intent: message.intent,
      })),
    intent: input.intent,
    privacy: {
      sendsUnsavedWorking: Boolean(typedAnswer || typedWorking || selectedWorkingText || scratchpadHasDrawing || scratchpadNote),
      persistsUnsavedWorking: false,
    },
  };
}

export function normalizeTutorContextPacket(value: unknown, intent: PracticeTutorIntent): TutorContextPacket | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const question = record.question && typeof record.question === "object" ? record.question as Record<string, unknown> : {};
  const studentState =
    record.studentState && typeof record.studentState === "object"
      ? record.studentState as Record<string, unknown>
      : {};
  const scratchpad =
    studentState.scratchpad && typeof studentState.scratchpad === "object"
      ? studentState.scratchpad as Record<string, unknown>
      : null;
  const privacy = record.privacy && typeof record.privacy === "object" ? record.privacy as Record<string, unknown> : {};

  return {
    question: {
      id: cleanOptionalText(question.id, 160) ?? "",
      text: cleanOptionalText(question.text, 4_000) ?? "",
      expectedAnswer: cleanOptionalText(question.expectedAnswer, 2_000),
      solutionNotes: cleanOptionalText(question.solutionNotes, 4_000),
      topicIds: cleanStringArray(question.topicIds, 20, 160),
      topicNames: cleanStringArray(question.topicNames, 8, 160),
      sourceIds: cleanStringArray(question.sourceIds, 20, 160),
      sourceTitles: cleanStringArray(question.sourceTitles, 8, 240),
    },
    studentState: {
      typedAnswer: cleanOptionalText(studentState.typedAnswer, 3_000),
      typedWorking: cleanOptionalText(studentState.typedWorking, 3_000),
      selectedWorkingText: cleanOptionalText(studentState.selectedWorkingText, 1_500),
      scratchpad: scratchpad
        ? {
            hasDrawing: scratchpad.hasDrawing === true,
            strokeCount:
              typeof scratchpad.strokeCount === "number" && Number.isFinite(scratchpad.strokeCount)
                ? Math.max(0, Math.round(scratchpad.strokeCount))
                : 0,
            note: cleanOptionalText(scratchpad.note, 1_500),
            imageAttached: false,
          }
        : undefined,
      confidence: cleanConfidence(studentState.confidence),
      mistakeLabels: cleanMistakeLabels(
        Array.isArray(studentState.mistakeLabels)
          ? studentState.mistakeLabels.filter((item): item is string => typeof item === "string")
          : undefined
      ),
    },
    attemptHistory: Array.isArray(record.attemptHistory)
      ? record.attemptHistory
          .filter((attempt): attempt is Record<string, unknown> => Boolean(attempt) && typeof attempt === "object")
          .slice(0, PRACTICE_ATTEMPT_HISTORY_LIMIT)
          .map((attempt) => ({
            answer: cleanOptionalText(attempt.answer, 1_500),
            workingText: cleanOptionalText(attempt.workingText, 1_500),
            correct: attempt.correct === true,
            confidence: cleanConfidence(attempt.confidence) ?? 3,
            mistakeLabels: cleanStringArray(attempt.mistakeLabels, 8, 80),
            createdAt: typeof attempt.createdAt === "number" ? attempt.createdAt : 0,
          }))
      : [],
    tutorHistory: Array.isArray(record.tutorHistory)
      ? record.tutorHistory
          .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object")
          .slice(-PRACTICE_TUTOR_HISTORY_LIMIT)
          .map((message) => ({
            role: message.role === "model" ? ("model" as const) : ("user" as const),
            text: cleanOptionalText(message.text, 1_500) ?? "",
            intent: cleanOptionalText(message.intent, 80),
          }))
          .filter((message) => message.text)
      : [],
    intent,
    privacy: {
      sendsUnsavedWorking: privacy.sendsUnsavedWorking === true,
      persistsUnsavedWorking: false,
    },
  };
}

export function buildLegacyTutorContextPacket(input: {
  intent: PracticeTutorIntent;
  questionId: string;
  questionText: string;
  answerText?: string;
  solutionText?: string;
  topicNames?: string[];
  userAnswer?: string;
  workingText?: string;
}): TutorContextPacket {
  const typedAnswer = cleanOptionalText(input.userAnswer, 3_000);
  const typedWorking = cleanOptionalText(input.workingText, 3_000);

  return {
    question: {
      id: input.questionId,
      text: input.questionText,
      expectedAnswer: cleanOptionalText(input.answerText, 2_000),
      solutionNotes: cleanOptionalText(input.solutionText, 4_000),
      topicIds: [],
      topicNames: cleanStringArray(input.topicNames ?? [], 8, 160),
      sourceIds: [],
      sourceTitles: [],
    },
    studentState: {
      typedAnswer,
      typedWorking,
      mistakeLabels: [],
    },
    attemptHistory: [],
    tutorHistory: [],
    intent: input.intent,
    privacy: {
      sendsUnsavedWorking: Boolean(typedAnswer || typedWorking),
      persistsUnsavedWorking: false,
    },
  };
}

function formatAttemptHistory(packet: TutorContextPacket) {
  if (packet.attemptHistory.length === 0) return "No previous attempts supplied.";
  return packet.attemptHistory
    .map((attempt, index) => {
      const labels = attempt.mistakeLabels.length ? attempt.mistakeLabels.join(", ") : "none";
      return `${index + 1}. ${attempt.correct ? "Correct" : "Incorrect"}; confidence ${attempt.confidence}; mistakes: ${labels}; answer: ${attempt.answer ?? "not supplied"}; working: ${attempt.workingText ?? "not supplied"}`;
    })
    .join("\n");
}

function formatTutorHistory(packet: TutorContextPacket) {
  if (packet.tutorHistory.length === 0) return "No recent tutor messages supplied.";
  return packet.tutorHistory
    .map((message) => `${message.role}${message.intent ? ` (${message.intent})` : ""}: ${message.text}`)
    .join("\n");
}

export function formatTutorContextPacketForPrompt(packet: TutorContextPacket) {
  const selectedText = packet.studentState.selectedWorkingText ?? "Not supplied";
  const scratchpad = packet.studentState.scratchpad;
  return `Question:
${packet.question.text}

Known answer:
${packet.question.expectedAnswer ?? "Not supplied"}

Stored solution:
${packet.question.solutionNotes ?? "Not supplied"}

Topics:
${packet.question.topicNames.length ? packet.question.topicNames.join(", ") : "Unspecified"}

Sources:
${packet.question.sourceTitles.length ? packet.question.sourceTitles.join(", ") : "Not supplied"}

Student answer:
${packet.studentState.typedAnswer ?? "Not supplied"}

Student working:
${packet.studentState.typedWorking ?? "Not supplied"}

Selected working text:
${selectedText}

Scratchpad:
${
  scratchpad
    ? `Drawing present: ${scratchpad.hasDrawing ? "yes" : "no"}; strokes: ${scratchpad.strokeCount}; image attached: no; student note: ${scratchpad.note ?? "Not supplied"}`
    : "Not supplied"
}

Confidence:
${packet.studentState.confidence ?? "Not supplied"}

Mistake labels:
${packet.studentState.mistakeLabels?.length ? packet.studentState.mistakeLabels.join(", ") : "Not supplied"}

Recent attempts:
${formatAttemptHistory(packet)}

Recent tutor messages:
${formatTutorHistory(packet)}

Privacy:
Context was sent only because the student clicked a Tutor action. Unsaved working may be used for this reply but is not persisted by the context packet.`;
}
