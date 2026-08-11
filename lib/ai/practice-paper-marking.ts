import { repairModelJsonBackslashes } from "@/lib/ai/model-json";
import {
  getPracticePaperGradeLabel,
  normalizePracticePaperResult,
  type PracticePaper,
  type PracticePaperResult,
} from "@/lib/practice/practice-papers";

function unwrapJson(value: string) {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

export function parsePracticePaperMarkingModelAnswer(
  value: string,
  paper: PracticePaper
): PracticePaperResult | null {
  let payload: unknown;
  try {
    payload = JSON.parse(repairModelJsonBackslashes(unwrapJson(value)));
  } catch {
    return null;
  }
  const normalized = normalizePracticePaperResult(payload);
  if (!normalized || normalized.questionResults.length === 0) return null;
  const questions = new Map(paper.questions.map((question) => [question.id, question]));
  const seen = new Set<string>();
  const questionResults = normalized.questionResults.flatMap((result) => {
    const question = questions.get(result.questionId);
    if (!question || seen.has(result.questionId)) return [];
    seen.add(result.questionId);
    return [{
      ...result,
      label: question.label,
      maxMarks: question.marks,
      awardedMarks: Math.min(question.marks, result.awardedMarks),
    }];
  });
  if (questionResults.length !== paper.questions.length) return null;
  const groupedIds = new Set(paper.choiceGroups.flatMap((group) => group.questionIds));
  const countedChoiceIds = new Set<string>();
  const resultById = new Map(questionResults.map((result) => [result.questionId, result]));
  const questionOrder = new Map(paper.questions.map((question, index) => [question.id, index]));
  paper.choiceGroups.forEach((group) => {
    const candidates = group.questionIds
      .map((questionId) => resultById.get(questionId))
      .filter((result): result is (typeof questionResults)[number] => Boolean(result));
    const ordered = group.selectionRule === "first_answered"
      ? [...candidates].sort((left, right) => {
          if (left.attempted !== right.attempted) return left.attempted ? -1 : 1;
          return (questionOrder.get(left.questionId) ?? 0) - (questionOrder.get(right.questionId) ?? 0);
        })
      : [...candidates].sort((left, right) =>
          right.awardedMarks - left.awardedMarks ||
          (questionOrder.get(left.questionId) ?? 0) - (questionOrder.get(right.questionId) ?? 0)
        );
    ordered.slice(0, group.requiredCount).forEach((result) =>
      countedChoiceIds.add(result.questionId)
    );
  });
  const countedResults = questionResults.map((result) => ({
    ...result,
    counted: !groupedIds.has(result.questionId) || countedChoiceIds.has(result.questionId),
  }));
  const totalMarks = paper.totalMarks;
  const awardedMarks = countedResults.reduce(
    (total, result) => total + (result.counted ? result.awardedMarks : 0),
    0
  );
  const percentage = totalMarks > 0
    ? Math.round((awardedMarks / totalMarks) * 1_000) / 10
    : 0;
  return {
    ...normalized,
    questionResults: countedResults,
    totalMarks,
    awardedMarks,
    percentage,
    gradeLabel: getPracticePaperGradeLabel(percentage, paper.gradeGuidance),
  };
}

export function mergePracticePaperQuestionRemark(input: {
  paper: PracticePaper;
  current: PracticePaperResult;
  replacement: PracticePaperResult["questionResults"][number];
}) {
  const questionResults = input.current.questionResults.map((question) =>
    question.questionId === input.replacement.questionId
      ? input.replacement
      : question
  );
  return parsePracticePaperMarkingModelAnswer(
    JSON.stringify({
      ...input.current,
      questionResults,
    }),
    input.paper
  );
}
