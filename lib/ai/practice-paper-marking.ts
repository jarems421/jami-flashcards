import { repairModelJsonBackslashes } from "@/lib/ai/model-json";
import { checkMarkConsistency } from "@/lib/practice/mark-consistency";
import { schemeCriteria } from "@/lib/practice/mark-schemes";
import {
  normalizePracticePaperResult,
  type PracticePaper,
  type PracticePaperResult,
} from "@/lib/practice/practice-papers";
import {
  calculatePracticePaperPercentage,
  getPracticePaperGradeLabel,
} from "@/lib/practice/practice-paper-grades";

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
    const awardedMarks = Math.min(question.marks, result.awardedMarks);
    const hasEvidence = (result.evidence?.some((item) => item.trim()) ?? false) ||
      (result.criterionResults?.some((criterion) => criterion.evidence.trim()) ?? false);
    if (result.awardedMarks > 0 && !hasEvidence) return [];
    /*
     * A mark lost has to be explained, the same way a mark given has to be
     * evidenced.
     *
     * Only the awarding side was ever checked, so a report could hand a student
     * 1 of 3 and say nothing whatever about the other two: no criterion naming
     * them, no improvement, no next step. The page then had to write "2 marks
     * were not awarded, read the feedback above" and hope the feedback said
     * something -- which is the product admitting it does not know why either.
     *
     * The student already knows what they got right. The part they came for is
     * the part that was missing, and a number on its own is the one thing that
     * cannot be practised against. Rejecting here fails the report into the
     * marker's own retry, which is where a fixable omission belongs.
     */
    const item = paper.markScheme?.items?.find((entry) => entry.questionId === question.id);
    /*
     * A criterion's tariff comes from the scheme, not from the report.
     *
     * A report may omit `maxMarks`, and a scheme point can be worth more than
     * one -- a flattened scheme is a single point worth the whole question. So
     * a part-credited criterion looks fully awarded whenever the tariff is
     * assumed to be 1, and the loss it does explain goes unseen.
     */
    const tariffByCriterionId = new Map(
      item ? schemeCriteria(item).map((entry) => [entry.id, entry.marks] as const) : []
    );
    const explainsLoss =
      (result.criterionResults ?? []).some((criterion) => {
        const tariff =
          (criterion.criterionId ? tariffByCriterionId.get(criterion.criterionId) : undefined) ??
          criterion.maxMarks ??
          1;
        const awarded = criterion.awardedMarks ?? (criterion.awarded ? tariff : 0);
        return (
          awarded < tariff &&
          Boolean(
            criterion.criterion?.trim() ||
              criterion.candidateValue?.trim() ||
              criterion.evidence?.trim()
          )
        );
      }) ||
      (result.improvements?.some((entry) => entry.trim()) ?? false) ||
      Boolean(result.nextStep?.trim());
    if (awardedMarks < question.marks && !explainsLoss) return [];

    /*
     * A total that disagrees with the awards it was built from is not a
     * marking, it is two answers. Rejecting the question here fails the
     * whole report, which is what puts it through the parse-retry the marker
     * already has -- a bounded repair rather than a contradictory score shown
     * to a student beside feedback that argues for a different one.
     */
    const consistency = item
      ? checkMarkConsistency({
          item,
          reportedMarks: awardedMarks,
          criteria: result.criterionResults ?? [],
        })
      : undefined;
    if (consistency?.status === "inconsistent") return [];
    return [{
      ...result,
      label: question.label,
      maxMarks: question.marks,
      awardedMarks,
      // Carried on the result so nothing downstream has to assume a mark was
      // reconciled, and an unverifiable one cannot pass as a checked one.
      ...(consistency
        ? {
            markConsistency: {
              status: consistency.status,
              ...(consistency.status === "consistent" ? { checked: consistency.checked } : {}),
              ...("detail" in consistency ? { detail: consistency.detail } : {}),
            },
          }
        : {}),
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
  const percentage = calculatePracticePaperPercentage(awardedMarks, totalMarks);
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
