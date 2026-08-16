import { repairModelJsonBackslashes } from "@/lib/ai/model-json";

/**
 * Why a marking report could not be read.
 *
 * "Invalid report" was one label over at least five different faults, which
 * made a 12.5% failure rate impossible to act on: a model that truncates needs
 * a bigger output budget, one that omits a question needs a firmer prompt, and
 * one that refuses needs neither. Classifying them separates the ones worth
 * fixing from the ones worth retrying.
 *
 * Nothing here repairs a report or guesses a mark. A malformed response means
 * the marking did not happen, and the only honest record of that is a refusal.
 */

export type MarkingParseFailure =
  | "invalid_json"
  | "truncated"
  | "wrong_schema"
  | "missing_questions"
  | "mark_out_of_range"
  | "missing_evidence"
  | "refusal"
  | "empty";

export type ParseFailureDiagnosis = {
  kind: MarkingParseFailure;
  detail: string;
  /** Characters returned, so truncation against the output cap is visible. */
  length: number;
};

const REFUSAL = /\b(I(?:'m| am) (?:sorry|unable)|cannot (?:assist|comply|provide)|as an AI)\b/i;

function unwrap(value: string) {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/**
 * Diagnose a report the marking parser rejected.
 *
 * `expectedQuestionIds` is what the paper asked for, so a report that is
 * perfectly well-formed but silently drops a question is distinguishable from
 * one that is malformed — a distinction that matters, because the first is a
 * prompt problem and the second is a decoding one.
 */
export function classifyMarkingParseFailure(input: {
  raw: string;
  expectedQuestionIds: readonly string[];
  maxMarksByQuestion?: Record<string, number>;
}): ParseFailureDiagnosis {
  const raw = input.raw ?? "";
  const length = raw.length;
  if (!raw.trim()) return { kind: "empty", detail: "The model returned nothing.", length };
  if (REFUSAL.test(raw.slice(0, 400))) {
    return { kind: "refusal", detail: "The model declined to mark.", length };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(repairModelJsonBackslashes(unwrap(raw)));
  } catch (error) {
    // A response cut off by the output cap is still invalid JSON, but it is a
    // different problem with a different fix, and the tell is that it stops
    // without ever closing.
    const opens = (raw.match(/[[{]/g) ?? []).length;
    const closes = (raw.match(/[\]}]/g) ?? []).length;
    return {
      kind: opens > closes ? "truncated" : "invalid_json",
      detail:
        opens > closes
          ? `Output stops with ${opens - closes} unclosed bracket(s); likely cut off by the token cap.`
          : `Not valid JSON: ${error instanceof Error ? error.message.slice(0, 120) : "parse error"}`,
      length,
    };
  }

  if (typeof payload !== "object" || payload === null) {
    return { kind: "wrong_schema", detail: "Parsed, but not an object.", length };
  }
  const report = payload as Record<string, unknown>;
  const results = report.questionResults;
  if (!Array.isArray(results)) {
    return { kind: "wrong_schema", detail: "No questionResults array.", length };
  }

  const seen = new Set(
    results
      .map((entry) => (entry as { questionId?: unknown } | null)?.questionId)
      .filter((id): id is string => typeof id === "string")
  );
  const missing = input.expectedQuestionIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return {
      kind: "missing_questions",
      detail: `Returned ${seen.size} of ${input.expectedQuestionIds.length} questions; missing ${missing.join(", ")}.`,
      length,
    };
  }

  for (const entry of results as Record<string, unknown>[]) {
    const questionId = String(entry.questionId ?? "");
    const awarded = Number(entry.awardedMarks);
    const max = input.maxMarksByQuestion?.[questionId];
    if (Number.isFinite(awarded) && max !== undefined && (awarded < 0 || awarded > max)) {
      return {
        kind: "mark_out_of_range",
        detail: `${questionId} awarded ${awarded} of ${max}.`,
        length,
      };
    }
    // The shipped parser drops any scoring question with no evidence, which
    // then fails the question count. Naming it directly saves that fault being
    // read as malformed output.
    const evidence = Array.isArray(entry.evidence)
      ? (entry.evidence as unknown[]).some((item) => String(item ?? "").trim())
      : false;
    const criterionEvidence = Array.isArray(entry.criterionResults)
      ? (entry.criterionResults as { evidence?: unknown }[]).some((criterion) =>
          String(criterion?.evidence ?? "").trim()
        )
      : false;
    if (Number.isFinite(awarded) && awarded > 0 && !evidence && !criterionEvidence) {
      return {
        kind: "missing_evidence",
        detail: `${questionId} awarded ${awarded} with no evidence quoted; the parser discards it.`,
        length,
      };
    }
  }

  return { kind: "wrong_schema", detail: "Structurally complete but rejected by the parser.", length };
}
