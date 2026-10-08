/**
 * The routing preflight: a one-line worker call that asks whether a Tutor
 * request the rules could not place needs the supervisor. Deterministic rules
 * own every clear case (`decideTutorRoute`); this is only for the rest.
 */

export type TutorRoutingPreflight = {
  role: "worker" | "supervisor";
  confidence: "high" | "low";
  insufficientReasoning: boolean;
};

/**
 * Deterministic rules own clear cases; only genuinely ambiguous routine
 * requests spend a tiny hidden worker call on routing.
 */
export function shouldRunTutorRoutingPreflight(input: {
  message: string;
  routeRole: "worker" | "supervisor" | "juror";
  routineNotebookMarking: boolean;
  /** The student's thinking level. Low and High have already chosen the model, so nothing is left to ask. */
  reasoningEffort?: "low" | "medium" | "high";
}) {
  if (input.routeRole !== "worker" || input.routineNotebookMarking) return false;
  if (input.reasoningEffort === "low" || input.reasoningEffort === "high") return false;
  const message = input.message.trim();
  const obviousSimple =
    message.length <= 220 &&
    /^(?:what (?:is|are)|define|name|list|give me (?:one|a) (?:hint|example)|translate|spell|when (?:is|was)|who (?:is|was)|yes or no)\b/i.test(
      message
    );
  return !obviousSimple;
}

export function parseTutorRoutingPreflight(
  value: string
): TutorRoutingPreflight | null {
  try {
    const normalized = value
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const payload = JSON.parse(normalized) as Record<string, unknown>;
    if (
      (payload.role !== "worker" && payload.role !== "supervisor") ||
      (payload.confidence !== "high" && payload.confidence !== "low") ||
      typeof payload.insufficientReasoning !== "boolean"
    ) {
      return null;
    }
    return {
      role: payload.role,
      confidence: payload.confidence,
      insufficientReasoning: payload.insufficientReasoning,
    };
  } catch {
    return null;
  }
}
