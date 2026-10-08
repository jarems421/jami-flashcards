import type { TutorThinkingChoice, TutorThinkingTier } from "@/lib/ai/tutor-thinking";

/**
 * The routing preflight: a one-line call to the fast model that places a Tutor
 * question the rules could not (`chooseTutorThinking`). It runs on Auto only,
 * for the questions left unsettled, and never escalates itself: a model that
 * thinks for thousands of tokens cannot answer a one-line classification in its
 * cap or its seven seconds.
 */

/** What the preflight is asked to return, word for word. */
export const TUTOR_ROUTING_PREFLIGHT_INSTRUCTION =
  'Classify how much thought a tutor needs for this request. "quick": recall, a definition, a short fact, a hint, or chat. "think": working something out, an explanation of why or how, a calculation, a proof, feedback on work. "deep": only for a request that needs long, careful multi-step reasoning across many claims or sources, where a fast answer is likely to be wrong. Return exactly JSON: {"tier":"quick|think|deep","confidence":"high|low"}. Never answer the student.';

export type TutorRoutingPreflight = {
  tier: TutorThinkingTier;
  confidence: "high" | "low";
};

/** Only what the rules left open; Low, Medium and High have already chosen. */
export function shouldRunTutorRoutingPreflight(choice: TutorThinkingChoice) {
  return !choice.settled;
}

/**
 * The preflight's tier, applied to an unsettled question. Only a confident
 * "quick" makes it quicker, so an unsure classifier never thins out an answer,
 * and "deep" is taken as given: the classifier is asked for it sparingly.
 */
export function applyTutorRoutingPreflight(
  choice: TutorThinkingChoice,
  preflight: TutorRoutingPreflight | null
): TutorThinkingChoice {
  if (!preflight || choice.settled) return choice;
  if (preflight.tier === "deep") return { tier: "deep", reason: "routing_preflight", settled: true };
  if (preflight.tier === "quick" && preflight.confidence === "high") {
    return { tier: "quick", reason: "routing_preflight", settled: true };
  }
  return { ...choice, settled: true };
}

export function parseTutorRoutingPreflight(value: string): TutorRoutingPreflight | null {
  try {
    const normalized = value
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const payload = JSON.parse(normalized) as Record<string, unknown>;
    if (
      (payload.tier !== "quick" && payload.tier !== "think" && payload.tier !== "deep") ||
      (payload.confidence !== "high" && payload.confidence !== "low")
    ) {
      return null;
    }
    return { tier: payload.tier, confidence: payload.confidence };
  } catch {
    return null;
  }
}
