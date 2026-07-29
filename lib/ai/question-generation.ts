import { cleanGeneratedCardText } from "@/lib/ai/card-autocomplete";
import { extractJsonArray } from "@/lib/ai/model-json";

export const MAX_SOURCE_QUESTION_DRAFTS = 5;

export type GeneratedQuestionDraft = {
  questionText: string;
  answerText?: string;
  solutionText?: string;
};

function normalizeQuestionDraft(value: unknown): GeneratedQuestionDraft | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const questionValue = record.questionText ?? record.question ?? record.prompt;
  const answerValue = record.answerText ?? record.expectedAnswer ?? record.answer;
  const solutionValue = record.solutionText ?? record.solutionNotes ?? record.method;
  const questionText =
    typeof questionValue === "string"
      ? cleanGeneratedCardText(questionValue).slice(0, 4_000)
      : "";
  const answerText =
    typeof answerValue === "string"
      ? cleanGeneratedCardText(answerValue).slice(0, 4_000)
      : "";
  const solutionText =
    typeof solutionValue === "string"
      ? cleanGeneratedCardText(solutionValue).slice(0, 8_000)
      : "";

  if (!questionText) return null;

  return {
    questionText,
    answerText: answerText || undefined,
    solutionText: solutionText || undefined,
  };
}

function parseFallbackQuestions(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const questionMatch = block.match(/(?:question|prompt)\s*:\s*(.+)/i);
      const answerMatch = block.match(/(?:expected answer|answer)\s*:\s*(.+)/i);
      const solutionMatch = block.match(/(?:solution notes|solution|method)\s*:\s*([\s\S]+)/i);
      return normalizeQuestionDraft({
        questionText: questionMatch?.[1],
        answerText: answerMatch?.[1],
        solutionText: solutionMatch?.[1],
      });
    })
    .filter((draft): draft is GeneratedQuestionDraft => draft !== null);
}

export function parseGeneratedQuestionDrafts(text: string) {
  try {
    const parsed = JSON.parse(extractJsonArray(text)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeQuestionDraft)
      .filter((draft): draft is GeneratedQuestionDraft => draft !== null)
      .slice(0, MAX_SOURCE_QUESTION_DRAFTS);
  } catch {
    return parseFallbackQuestions(text).slice(0, MAX_SOURCE_QUESTION_DRAFTS);
  }
}
