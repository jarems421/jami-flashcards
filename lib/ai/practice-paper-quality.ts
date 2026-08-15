import type { ParsedPracticePaperModelAnswer } from "@/lib/ai/practice-paper-generation";
import { calculatePracticePaperTotalMarks } from "@/lib/practice/practice-papers";
import {
  validateMarkSchemeItem,
  type MarkSchemeIssue,
} from "@/lib/practice/mark-schemes";

/**
 * Everything wrong with a paper's marking guide, said specifically.
 *
 * This runs with no model in the loop, before anything is stored, and it is the
 * one class of check that shared model bias cannot defeat: two markers can
 * agree on a wrong mark, but they cannot agree that 1 + 1 + 1 is 5.
 *
 * It returns issues rather than a bare verdict so the repair pass can be told
 * what to fix. A retry that only knows it failed is a retry that reproduces the
 * same scheme.
 */
export function markSchemeIssues(
  paper: Extract<ParsedPracticePaperModelAnswer, { status: "ready" }>
): MarkSchemeIssue[] {
  const issues: MarkSchemeIssue[] = [];
  const schemes = new Map(paper.markScheme.items.map((item) => [item.questionId, item]));
  for (const question of paper.questions) {
    const scheme = schemes.get(question.id);
    if (!scheme) {
      // Also the landing point for an item the normalizer refused to read: a
      // dropped item is a missing item by the time it reaches here.
      issues.push({
        questionId: question.id,
        code: "missing_scheme",
        detail: "No readable marking guide for this question.",
      });
      continue;
    }
    if (scheme.maxMarks !== question.marks) {
      issues.push({
        questionId: question.id,
        code: "marks_mismatch",
        detail: `Guide says ${scheme.maxMarks} marks; the fixed question is worth ${question.marks}.`,
      });
    }
    issues.push(...validateMarkSchemeItem(scheme));
  }
  return issues;
}

export type PracticePaperQualityIssue = {
  code: string;
  severity: "warning" | "error";
  detail: string;
  questionId?: string;
};

export function isCompletePracticePaperCandidate(
  paper: ParsedPracticePaperModelAnswer
) {
  if (paper.status !== "ready") return false;
  if (
    paper.durationMinutes < 30 ||
    paper.durationMinutes > 360 ||
    paper.totalMarks < 20 ||
    paper.totalMarks > 500 ||
    paper.questions.length < 2 ||
    paper.questions.length > 30 ||
    paper.markScheme.items.length !== paper.questions.length
  ) return false;
  const questionIds = new Set(paper.questions.map((question) => question.id));
  if (questionIds.size !== paper.questions.length) return false;
  if (paper.questions.some((question) =>
    question.prompt.trim().length < 8 ||
    question.label.trim().length === 0 ||
    question.marks < 1 ||
    question.marks > 100 ||
    question.assets.some((asset) =>
      !asset.id.trim() ||
      !asset.title.trim() ||
      !asset.altText.trim() ||
      (!(asset.type === "image" || asset.type === "illustration") && !asset.content.trim()) ||
      ((asset.type === "image" || asset.type === "illustration") && !asset.content.trim() && !asset.storagePath)
    )
  )) return false;
  const rasterCount = paper.questions.reduce(
    (total, question) => total + question.assets.filter(
      (asset) => asset.type === "image" || asset.type === "illustration"
    ).length,
    0
  );
  if (rasterCount > 8) return false;
  if (markSchemeIssues(paper).length > 0) return false;
  const grouped = new Set<string>();
  for (const group of paper.choiceGroups) {
    if (
      group.requiredCount < 1 ||
      group.requiredCount > group.questionIds.length ||
      new Set(group.questionIds).size !== group.questionIds.length ||
      group.questionIds.some((questionId) =>
        !questionIds.has(questionId) || grouped.has(questionId)
      )
    ) return false;
    group.questionIds.forEach((questionId) => grouped.add(questionId));
  }
  return calculatePracticePaperTotalMarks(
    paper.questions,
    paper.choiceGroups
  ) === paper.totalMarks;
}

export function sameFixedPaper(
  left: ParsedPracticePaperModelAnswer,
  right: ParsedPracticePaperModelAnswer
) {
  if (left.status !== "ready" || right.status !== "ready") return false;
  const fixed = (paper: Extract<ParsedPracticePaperModelAnswer, { status: "ready" }>) => ({
    assessmentProfile: paper.assessmentProfile,
    title: paper.title,
    instructions: paper.instructions,
    durationMinutes: paper.durationMinutes,
    questions: paper.questions,
    choiceGroups: paper.choiceGroups,
    totalMarks: paper.totalMarks,
    sourceRefs: paper.sourceRefs,
  });
  return JSON.stringify(fixed(left)) === JSON.stringify(fixed(right));
}

export function parsePracticePaperQualityAudit(value: string) {
  try {
    const normalized = value
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    const payload = JSON.parse(
      start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized
    ) as Record<string, unknown>;
    if (!Array.isArray(payload.issues)) return null;
    const issues = payload.issues.slice(0, 30).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const issue = candidate as Record<string, unknown>;
      const code = typeof issue.code === "string" ? issue.code.trim().slice(0, 80) : "";
      const detail = typeof issue.detail === "string" ? issue.detail.trim().slice(0, 1_000) : "";
      if (!code || !detail) return [];
      return [{
        code,
        severity: issue.severity === "warning" ? "warning" as const : "error" as const,
        detail,
        questionId:
          typeof issue.questionId === "string"
            ? issue.questionId.trim().slice(0, 80) || undefined
            : undefined,
      }];
    });
    return { pass: payload.pass === true && issues.length === 0, issues };
  } catch {
    return null;
  }
}
