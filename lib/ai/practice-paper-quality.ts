import type { ParsedPracticePaperModelAnswer } from "@/lib/ai/practice-paper-generation";

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
  return (
    paper.durationMinutes >= 30 &&
    paper.totalMarks >= 20 &&
    paper.questions.length >= 1 &&
    paper.markScheme.items.length === paper.questions.length
  );
}

export function sameFixedPaper(
  left: ParsedPracticePaperModelAnswer,
  right: ParsedPracticePaperModelAnswer
) {
  if (left.status !== "ready" || right.status !== "ready") return false;
  return JSON.stringify(left.questions.map((question) => ({
    id: question.id,
    marks: question.marks,
    prompt: question.prompt,
  }))) === JSON.stringify(right.questions.map((question) => ({
    id: question.id,
    marks: question.marks,
    prompt: question.prompt,
  })));
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
