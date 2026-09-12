import { classifyAnswerShape } from "@/lib/study/answer-marking";
import { hasMathDelimiters } from "@/lib/study/math-text";
import type { Card } from "@/lib/study/cards";
import type { StudyMode } from "@/lib/study/study-modes";

export type StudyLearningTask =
  | "term"
  | "definition"
  | "quantity"
  | "calculation"
  | "list"
  | "process"
  | "comparison"
  | "explanation"
  | "formula"
  | "quotation"
  | "extended"
  | "ambiguous";

export type StudyTaskProfile = {
  task: StudyLearningTask;
  preferredModes: StudyMode[];
  suitableModes: StudyMode[];
  reasons: string[];
  source: "deterministic" | "prepared";
};

const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

/** Conservative local profile used when no reviewed preparation is available. */
export function classifyStudyTask(card: Pick<Card, "front" | "back">): StudyTaskProfile {
  const front = card.front.trim();
  const back = card.back.trim();
  const joined = `${front}\n${back}`;
  const answerWords = wordCount(back);
  const question = front.toLowerCase();
  const shape = classifyAnswerShape(back);
  const profile = (task: StudyLearningTask, preferredModes: StudyMode[], suitableModes: StudyMode[], reason: string): StudyTaskProfile => ({
    task, preferredModes, suitableModes: Array.from(new Set([...preferredModes, ...suitableModes, "classic"])),
    reasons: [reason], source: "deterministic",
  });

  if (!front || !back) return profile("ambiguous", ["classic"], [], "missing-content");
  if (answerWords > 55) return profile("extended", ["classic"], [], "extended-answer");
  if (hasMathDelimiters(back) && answerWords <= 12) {
    return profile("formula", ["classic"], ["type-answer"], "maths-heavy-answer");
  }
  if (/\b(calculate|work out|solve|find the value|determine)\b/.test(question)) {
    return profile("calculation", ["type-answer", "classic"], [], "calculation-command");
  }
  if (shape === "numeric") {
    return profile("quantity", ["type-answer", "classic"], ["multiple-choice"], "quantity-answer");
  }
  if (shape === "list" || /\b(list|name all|give \d+|state \d+)\b/.test(question)) {
    return profile("list", ["type-answer", "classic"], ["gap-fill"], "list-recall");
  }
  if (/\b(compare|difference|similarit|whereas|contrast)\b/.test(question)) {
    return profile("comparison", ["classic", "multiple-choice"], ["gap-fill", "type-answer"], "comparison-command");
  }
  if (/\b(why|explain|how does|how do|cause|because)\b/.test(question)) {
    return profile("explanation", ["classic", "gap-fill"], answerWords <= 24 ? ["type-answer"] : [], "explanation-command");
  }
  if (/\b(order|sequence|stages|steps|process)\b/.test(joined.toLowerCase())) {
    return profile("process", ["classic", "gap-fill"], answerWords <= 20 ? ["type-answer"] : [], "ordered-process");
  }
  if (/\b(quote|quotation|line from|phrase from)\b/.test(question)) {
    return profile("quotation", ["gap-fill", "classic"], ["type-answer"], "quotation-recall");
  }
  if (/\b(define|definition|what (?:is|are|does)\b|means?)\b/.test(question) && answerWords >= 4) {
    return profile("definition", ["classic", "gap-fill"], answerWords <= 18 ? ["type-answer", "multiple-choice"] : [], "definition-recall");
  }
  if (answerWords <= 4) {
    return profile("term", ["type-answer", "classic"], ["multiple-choice"], "short-term-recall");
  }
  return profile("definition", ["classic", "gap-fill"], answerWords <= 24 ? ["type-answer"] : [], "prose-recall");
}
