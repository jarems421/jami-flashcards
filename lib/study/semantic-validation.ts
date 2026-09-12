import type { ExerciseVerdict } from "@/lib/study/study-modes";

export type GapOutcome = { gapId: string; verdict: ExerciseVerdict; feedback?: string };
export function mergeGapOutcomes(local: GapOutcome[], semantic: GapOutcome[] = []) {
  const outcomes = local.map((item) => {
    if (item.verdict !== "needs-self-grade" && item.verdict !== "close") return item;
    const matches = semantic.filter((candidate) => candidate.gapId === item.gapId);
    return matches.length === 1 ? matches[0] : { ...item, verdict: "needs-self-grade" as const };
  });
  const verdict: ExerciseVerdict = outcomes.some((item) => item.verdict === "needs-self-grade" || item.verdict === "close")
    ? "needs-self-grade" : outcomes.every((item) => item.verdict === "correct") ? "correct"
      : outcomes.every((item) => item.verdict === "incorrect") ? "incorrect" : "partial";
  return { verdict, outcomes };
}

/** Confidence is not evidence. Reject contradictions and unsupported awards. */
export function validateSemanticResult(value: unknown, response: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (!["correct", "partial", "incorrect"].includes(String(result.verdict))) return null;
  if (typeof result.feedback !== "string" || !result.feedback.trim()) return null;
  if (!Array.isArray(result.missingConcepts) || !Array.isArray(result.coveredConcepts)) return null;
  if (result.verdict === "correct" && result.missingConcepts.length) return null;
  if (result.verdict === "partial" && (!result.missingConcepts.length || !result.coveredConcepts.length)) return null;
  if (result.verdict !== "incorrect") {
    if (!Array.isArray(result.evidence) || !result.evidence.length || result.evidence.some((quote) => typeof quote !== "string" || !quote.trim() || !response.includes(quote))) return null;
  }
  // Low confidence can request another check; high confidence cannot waive the checks above.
  if (typeof result.confidence === "number" && result.confidence < 0.7) return null;
  return result;
}
