import type { LearnerProfile } from "@/lib/learning/types";

/**
 * What a learner profile looked like, as aggregate numbers and fixed codes.
 *
 * Built for logs: counts, reason codes and flags only. No topic or deck names
 * (student-written), no error labels, no ids -- nothing that describes what a
 * student studied, only how much evidence there was and what the engine did
 * with it.
 */
export function learnerProfileTelemetry(profile: LearnerProfile) {
  const decisions = profile.topics.map((topic) => topic.decision?.reason ?? "none");
  return {
    algorithmVersion: profile.algorithmVersion,
    scope: profile.scope.folderId ? "folder" : "deck",
    observations: profile.diagnostics.observations,
    droppedObservations: profile.diagnostics.droppedObservations,
    topicSignals: profile.diagnostics.topicSignals,
    topicStates: profile.topics.length,
    strengths: profile.strengths.length,
    weaknesses: profile.weaknesses.length,
    uncertainTopics: profile.uncertain.length,
    improvingTopics: profile.improving.length,
    leftAlone: decisions.filter((reason) => reason === "stable_strength").length,
    untestedExposed: decisions.filter((reason) => reason === "untested_exposure").length,
    decayingTopics: profile.topics.filter((topic) => topic.memory.includes("decaying")).length,
    recurringErrors: profile.recurringErrors.length,
    activeRecurringErrors: profile.recurringErrors.filter((error) => error.status === "active").length,
    recentTrend: profile.recentTrend,
    recommendationReasons: profile.recommendedFocus.map((recommendation) => recommendation.reason),
    topRecommendation: profile.recommendedFocus[0]?.reason ?? "none",
    flashcardReviewEvents: profile.evidenceSummary.flashcardReviewEvents,
    pastPaperAttempts: profile.evidenceSummary.pastPaperAttempts,
    practiceAttempts: profile.evidenceSummary.practiceAttempts,
    specificationTopicsNotAssessed: profile.coverage?.notYetAssessed.length,
    limitsReached: profile.diagnostics.limitsReached,
    unavailableSources: profile.diagnostics.unavailableSources,
  };
}
