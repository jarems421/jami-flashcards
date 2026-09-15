import {
  compareErrorDetection,
  learningErrorLabel,
} from "@/lib/learning/profile/error-patterns";
import type {
  LearningError,
  LearningErrorCategory,
  LearningErrorDetection,
  LearningErrorStatus,
  LearningEvidenceKind,
  LearningObservation,
} from "@/lib/learning/types";

/** A single lost mark is a slip. Twice is where a pattern can start. */
export const MIN_RECURRING_OCCURRENCES = 2;
export const MIN_RECURRING_CONFIDENCE = 0.3;
/** Below this a recurring error is emerging rather than established. */
export const ACTIVE_ERROR_CONFIDENCE = 0.5;
/** Successful chances in a row, since the last miss, before an error reads as improving. */
export const IMPROVING_STREAK = 2;
/**
 * Successful chances in a row before an error reads as likely resolved -- and
 * they must span more than one question, so getting the same question right
 * three times does not count.
 */
export const RESOLVED_STREAK = 3;

/** Two occurrences give about 63% confidence, three about 78%, four about 86%. */
const RECURRING_OCCURRENCE_SCALE = 2;

const STATUS_ORDER: readonly LearningErrorStatus[] = [
  "active",
  "emerging",
  "improving",
  "likely_resolved",
];

const EVIDENCE_ORDER: readonly LearningEvidenceKind[] = ["flashcards", "practice", "past-paper"];

type ErrorChance = {
  at: number;
  missed: boolean;
  kind: LearningEvidenceKind;
  itemId: string;
  detection: LearningErrorDetection;
};

/**
 * Confidence that a category is a real habit rather than bad luck.
 *
 * It grows with the number of times marks were lost, and shrinks with how
 * often the student got the same kind of criterion right: losing units marks
 * twice in two chances is a habit, twice in ten is not much of one.
 */
export function recurringErrorConfidence(occurrences: number, opportunities: number) {
  if (occurrences <= 0 || opportunities <= 0) return 0;
  const volume = 1 - Math.exp(-occurrences / RECURRING_OCCURRENCE_SCALE);
  return volume * Math.sqrt(Math.min(1, occurrences / opportunities));
}

function errorStatus(ordered: readonly ErrorChance[], confidence: number): LearningErrorStatus {
  let streak = 0;
  const streakItems = new Set<string>();
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const chance = ordered[index];
    if (!chance || chance.missed) break;
    streak += 1;
    streakItems.add(chance.itemId);
  }
  if (streak >= RESOLVED_STREAK && streakItems.size > 1) return "likely_resolved";
  if (streak >= IMPROVING_STREAK) return "improving";
  return confidence < ACTIVE_ERROR_CONFIDENCE ? "emerging" : "active";
}

/**
 * Recurring errors across every marked answer in scope.
 *
 * A retry of the same question counts again. Losing the justification mark on
 * the first attempt and again on the guided retry, straight after reading why,
 * is the strongest evidence of a persistent habit there is. Observations are
 * expected in canonical order; chances are re-sorted by time regardless.
 */
export function buildRecurringErrors(
  observations: readonly LearningObservation[]
): LearningError[] {
  const chances = new Map<LearningErrorCategory, ErrorChance[]>();
  for (const observation of observations) {
    for (const check of observation.errorChecks) {
      const list = chances.get(check.category) ?? [];
      list.push({
        at: observation.at,
        missed: check.missed,
        kind: observation.kind,
        itemId: observation.itemId,
        detection: check.detection,
      });
      chances.set(check.category, list);
    }
  }

  const errors: LearningError[] = [];
  for (const [category, list] of chances) {
    const ordered = [...list].sort(
      (left, right) => left.at - right.at || left.itemId.localeCompare(right.itemId)
    );
    const missed = ordered.filter((chance) => chance.missed);
    if (missed.length < MIN_RECURRING_OCCURRENCES) continue;
    const confidence = recurringErrorConfidence(missed.length, ordered.length);
    if (confidence < MIN_RECURRING_CONFIDENCE) continue;
    const kinds = new Set(missed.map((chance) => chance.kind));
    errors.push({
      category,
      label: learningErrorLabel(category),
      occurrences: missed.length,
      opportunities: ordered.length,
      uniqueItems: new Set(missed.map((chance) => chance.itemId)).size,
      confidence,
      status: errorStatus(ordered, confidence),
      lastSeenAt: missed.reduce((latest, chance) => Math.max(latest, chance.at), 0),
      lastOpportunityAt: ordered.reduce((latest, chance) => Math.max(latest, chance.at), 0),
      evidence: EVIDENCE_ORDER.filter((kind) => kinds.has(kind)),
      detection: Array.from(new Set(ordered.map((chance) => chance.detection))).sort(
        compareErrorDetection
      ),
    });
  }

  return errors.sort(
    (left, right) =>
      STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status) ||
      right.confidence - left.confidence ||
      right.occurrences - left.occurrences ||
      left.category.localeCompare(right.category)
  );
}
