import {
  buildDescendantIndex,
  conceptAncestors,
  type ConceptRegistry,
} from "@/lib/learning/concepts/registry";
import { emptyExposure, hasExposure } from "@/lib/learning/profile/exposure";
import {
  MIN_SIGNAL_CONFIDENCE,
  MIN_STRENGTH_CONFIDENCE,
  STRENGTH_MASTERY_FROM,
  TOPIC_FOCUS_CONFIDENCE,
  WEAKNESS_MASTERY_BELOW,
} from "@/lib/learning/profile/thresholds";
import type {
  LearningDemonstration,
  LearningExposure,
  LearningMemoryState,
  LearningRecommendationReason,
  LearningSignal,
  LearningTopicDecision,
  LearningTopicSource,
  LearningTopicState,
} from "@/lib/learning/types";

export function demonstrationOf(signal: LearningSignal | undefined): LearningDemonstration {
  if (!signal) return "none";
  if (signal.confidence < MIN_SIGNAL_CONFIDENCE) return "insufficient";
  if (signal.evidenceMastery < WEAKNESS_MASTERY_BELOW) return "weak";
  if (
    signal.evidenceMastery >= STRENGTH_MASTERY_FROM &&
    signal.confidence >= MIN_STRENGTH_CONFIDENCE
  ) {
    return "strong";
  }
  return "developing";
}

/**
 * Due is the scheduler's own call. Decaying needs dated history showing the
 * topic was strong in the earlier window and has declined since -- the
 * difference between "never learned" and "learned, now slipping", which calls
 * for retrieval rather than teaching from scratch.
 */
export function memoryOf(signal: LearningSignal | undefined): LearningMemoryState[] {
  if (!signal) return [];
  const states: LearningMemoryState[] = [];
  if (signal.dueCards > 0) states.push("due");
  if (
    signal.trend === "declining" &&
    signal.previousAccuracy !== undefined &&
    signal.previousAccuracy >= STRENGTH_MASTERY_FROM
  ) {
    states.push("decaying");
  }
  return states;
}

/**
 * Whether recall is holding up where application is not.
 *
 * Both halves must be established on their own evidence: marked exam or
 * practice answers on this concept that read weak on enough of them to say so,
 * and flashcard recall that reads strong on enough reviews to say that. Recall
 * is taken from this concept's own cards when it has any, and otherwise from
 * the student's own Topic directly covering it -- the "drilled Quadratics,
 * failed completing the square" case. It is never borrowed from a broader
 * specification heading, whose cards could be about something else entirely.
 */
export function applicationGapOf(
  signal: LearningSignal | undefined,
  covering: { topicKey: string; label: string; signal?: LearningSignal } | undefined,
  own: { topicKey: string; label: string }
): LearningTopicState["applicationGap"] {
  const application = signal?.claims?.application;
  if (
    !application ||
    application.confidence < MIN_SIGNAL_CONFIDENCE ||
    application.evidenceMastery >= WEAKNESS_MASTERY_BELOW
  ) {
    return undefined;
  }
  const source = signal?.claims?.recall
    ? { ...own, recall: signal.claims.recall }
    : covering?.signal?.claims?.recall
      ? { topicKey: covering.topicKey, label: covering.label, recall: covering.signal.claims.recall }
      : undefined;
  if (
    !source ||
    source.recall.evidenceMastery < STRENGTH_MASTERY_FROM ||
    source.recall.confidence < MIN_STRENGTH_CONFIDENCE
  ) {
    return undefined;
  }
  return { recallFrom: source.topicKey, recallLabel: source.label };
}

/**
 * The one decision the engine makes about a topic on its own evidence.
 *
 * The rules read as a tutor would reason: slipping after being strong is
 * recovered by retrieval; a well-evidenced weakness is taught; a suspected one
 * is checked first; something seen but never tested is checked; a strong topic
 * that is not due is left alone. A declared topic the student has not reached
 * gets no decision at all -- it is not a gap until they are meant to know it.
 */
export function decideTopic(input: {
  signal?: LearningSignal;
  demonstration: LearningDemonstration;
  memory: readonly LearningMemoryState[];
  exposure: LearningExposure;
  source: LearningTopicSource;
  declared: boolean;
  /** See `applicationGapOf`. */
  applicationGap?: boolean;
}): LearningTopicDecision | undefined {
  const { signal } = input;
  /*
   * First, because it is the most specific thing the evidence can say. The
   * blended mastery of such a concept can read anywhere from weak to fine,
   * and every reading would send the student to the wrong work: teaching what
   * they can already recall, or leaving alone what they cannot yet use. What
   * helps is practice at using it, sized by how sure the application evidence
   * is -- a confident gap is worked on, a thin one is checked.
   */
  const application = signal?.claims?.application;
  if (input.applicationGap && application) {
    return {
      action: "practice",
      reason: application.confidence >= TOPIC_FOCUS_CONFIDENCE ? "low_mastery" : "low_confidence",
    };
  }
  if (signal && input.memory.includes("decaying")) {
    return {
      action: signal.evidence.includes("flashcards") ? "retrieve" : "practice",
      reason: "knowledge_decay",
    };
  }
  const due = input.memory.includes("due");
  switch (input.demonstration) {
    case "weak":
      if (signal?.trend === "declining") return { action: "review", reason: "declining_mastery" };
      return (signal?.confidence ?? 0) >= TOPIC_FOCUS_CONFIDENCE
        ? { action: "teach", reason: "low_mastery" }
        : { action: "diagnose", reason: "low_confidence" };
    case "insufficient":
      if ((signal?.evidenceMastery ?? 1) < WEAKNESS_MASTERY_BELOW) {
        return { action: "diagnose", reason: "low_confidence" };
      }
      return due ? { action: "retrieve", reason: "due_for_retrieval" } : undefined;
    case "none":
      if (hasExposure(input.exposure)) return { action: "diagnose", reason: "untested_exposure" };
      return input.source === "specification" && input.declared
        ? { action: "diagnose", reason: "not_yet_assessed" }
        : undefined;
    case "developing":
      if (signal?.trend === "declining") return { action: "review", reason: "declining_mastery" };
      if (signal?.trend === "improving") {
        return { action: "reinforce", reason: "recent_improvement_needs_reinforcement" };
      }
      return due ? { action: "retrieve", reason: "due_for_retrieval" } : undefined;
    case "strong":
      return due
        ? { action: "retrieve", reason: "due_for_retrieval" }
        : { action: "leave_alone", reason: "stable_strength" };
  }
}

const PROBLEM_REASONS: ReadonlySet<LearningRecommendationReason> = new Set([
  "declining_mastery",
  "knowledge_decay",
  "low_mastery",
  "low_confidence",
]);
const MAINTENANCE_REASONS: ReadonlySet<LearningRecommendationReason> = new Set([
  "due_for_retrieval",
  "recent_improvement_needs_reinforcement",
]);

function hasSupportedEvidence(state: LearningTopicState) {
  return state.demonstration === "weak" || state.demonstration === "developing" || state.demonstration === "strong";
}

function decisionClass(state: LearningTopicState) {
  const decision = state.decision;
  if (!decision || decision.action === "leave_alone" || decision.reason === "stable_strength") return undefined;
  if (PROBLEM_REASONS.has(decision.reason)) return "problem";
  if (MAINTENANCE_REASONS.has(decision.reason)) return "maintenance";
  return undefined;
}

/**
 * Decisions placed at the finest level the evidence supports.
 *
 * Three rules, applied across the concept hierarchy:
 *
 * - A concept judged on too little evidence of its own -- a suspected weakness
 *   or due cards with only a couple of answers behind them -- defers to the
 *   nearest broader concept that does have enough. "Discriminants: two
 *   answers" is not a finding; "Algebra: forty answers" is.
 * - Untested areas are reported at their broadest untested level: a specification
 *   topic nobody has assessed stands in for its sub-concepts, and material seen
 *   but untested under an untested parent is one gap, not twenty.
 * - A broad concept whose problem is explained by finer, well-evidenced concepts
 *   is covered by them, so the recommendation names the specific concept
 *   rather than the whole area. Problems only cover problems and maintenance
 *   only covers maintenance, so a broad weakness is never hidden by a
 *   sub-concept that is merely due.
 */
export function resolveDecisionsAcrossConcepts(
  states: readonly LearningTopicState[],
  registry: ConceptRegistry
): LearningTopicState[] {
  const byKey = new Map(states.map((state) => [state.topicKey, state]));
  const nearestAncestor = (key: string, accept: (state: LearningTopicState) => boolean) => {
    for (const ancestorKey of conceptAncestors(registry, key)) {
      const ancestor = byKey.get(ancestorKey);
      if (ancestor && accept(ancestor)) return ancestor.topicKey;
    }
    return undefined;
  };

  const deferral = new Map<string, string>();
  for (const state of states) {
    const reason = state.decision?.reason;
    if (!reason) continue;
    let holder: string | undefined;
    if (state.demonstration === "insufficient" && (reason === "low_confidence" || reason === "due_for_retrieval")) {
      holder = nearestAncestor(state.topicKey, hasSupportedEvidence);
    } else if (reason === "not_yet_assessed") {
      holder = nearestAncestor(
        state.topicKey,
        (ancestor) => hasSupportedEvidence(ancestor) || ancestor.decision?.reason === "not_yet_assessed"
      );
    } else if (reason === "untested_exposure") {
      holder = nearestAncestor(state.topicKey, (ancestor) => ancestor.decision?.reason === "untested_exposure");
    }
    if (holder) deferral.set(state.topicKey, holder);
  }
  const finalHolder = (key: string) => {
    let holder = deferral.get(key);
    const seen = new Set<string>([key]);
    while (holder && deferral.has(holder) && !seen.has(holder)) {
      seen.add(holder);
      holder = deferral.get(holder);
    }
    return holder;
  };

  const descendants = buildDescendantIndex(registry);
  const coverage = new Map<string, string[]>();
  for (const state of states) {
    const kind = decisionClass(state);
    if (!kind || !hasSupportedEvidence(state) || deferral.has(state.topicKey)) continue;
    const explaining = (descendants.get(state.topicKey) ?? []).filter((key) => {
      const descendant = byKey.get(key);
      return (
        descendant !== undefined &&
        !deferral.has(key) &&
        hasSupportedEvidence(descendant) &&
        decisionClass(descendant) === kind
      );
    });
    if (explaining.length > 0) coverage.set(state.topicKey, explaining);
  }

  return states.map((state) => {
    const holder = finalHolder(state.topicKey);
    if (holder) {
      const deferred: LearningTopicState = { ...state, deferredTo: holder };
      delete deferred.decision;
      return deferred;
    }
    const coveredBy = coverage.get(state.topicKey);
    return coveredBy ? { ...state, coveredBy } : state;
  });
}

/**
 * Every concept in scope -- measured, exposed or declared -- with what the
 * engine believes about it. Sorted by key so the list is stable.
 */
export function buildTopicStates(input: {
  signals: readonly LearningSignal[];
  exposure: ReadonlyMap<string, LearningExposure>;
  registry: ConceptRegistry;
  declaredTopicKeys: readonly string[];
}): LearningTopicState[] {
  const signalsByKey = new Map(input.signals.map((signal) => [signal.topicKey, signal]));
  const declared = new Set(input.declaredTopicKeys);
  /** The student's own Topic nearest above a concept, which is what covers it. */
  const coveringTopic = (topicKey: string) => {
    for (const ancestorKey of conceptAncestors(input.registry, topicKey)) {
      const ancestor = input.registry.concepts.get(ancestorKey);
      if (ancestor?.source !== "student-topic") continue;
      const signal = signalsByKey.get(ancestorKey);
      return { topicKey: ancestorKey, label: ancestor.label, ...(signal ? { signal } : {}) };
    }
    return undefined;
  };
  const keys = new Set([...signalsByKey.keys(), ...input.exposure.keys(), ...declared]);

  const states: LearningTopicState[] = [];
  for (const topicKey of Array.from(keys).sort()) {
    const concept = input.registry.concepts.get(topicKey);
    if (!concept) continue;
    const signal = signalsByKey.get(topicKey);
    const exposure = { ...(input.exposure.get(topicKey) ?? emptyExposure()) };
    const demonstration = demonstrationOf(signal);
    const memory = memoryOf(signal);
    const applicationGap = applicationGapOf(signal, coveringTopic(topicKey), {
      topicKey,
      label: concept.label,
    });
    const decision = decideTopic({
      ...(signal ? { signal } : {}),
      demonstration,
      memory,
      exposure,
      source: concept.source,
      declared: declared.has(topicKey),
      applicationGap: Boolean(applicationGap),
    });
    states.push({
      topicKey,
      label: concept.label,
      source: concept.source,
      provenance: concept.provenance,
      ...(concept.parentKey ? { parentKey: concept.parentKey } : {}),
      declared: declared.has(topicKey),
      exposure,
      demonstration,
      memory,
      ...(signal ? { signal } : {}),
      ...(applicationGap ? { applicationGap } : {}),
      ...(decision ? { decision } : {}),
    });
  }
  return resolveDecisionsAcrossConcepts(states, input.registry);
}
