import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { parseStudyActionId } from "@/lib/learning/events/study-action-event";
import type { LearningRecommendationReason, LearningTopicSource } from "@/lib/learning/types";

/**
 * Practice Tutor offers under an answer, when the engine says practice is what
 * the topic in front of the student needs.
 *
 * It is the engine's own action, not something Tutor made up: the same id,
 * the same words and the same destination as Today, so starting it from here
 * rests it there, and the practice it leads to is marked and becomes evidence.
 * The model is told the offer exists and may recommend it; it never writes
 * one. See `practiceActionForMaterial`.
 */
export type TutorPracticeOffer = {
  actionId: string;
  reason: LearningRecommendationReason;
  target: { kind: "topic"; topicKey: string; label: string; source: LearningTopicSource };
  scope: { folderId?: string; deckId?: string };
  title: string;
  description: string;
  label: string;
  href: string;
};

const MAX_TEXT = 240;
const TOPIC_SOURCES: readonly LearningTopicSource[] = ["student-topic", "deck", "specification"];

/**
 * The offer for one of the engine's actions.
 *
 * `copy` is Today's own wording for it (`describeStudyAction`), passed in by
 * the server so the browser, which only ever reads offers, never loads the
 * planner that writes them.
 */
export function buildTutorPracticeOffer(
  action: StudyAction,
  copy: { title: string; description: string; label: string }
): TutorPracticeOffer | undefined {
  if (action.target.kind !== "topic" || !action.destination) return undefined;
  return {
    actionId: action.id,
    reason: action.reason,
    target: action.target,
    scope: action.scope,
    title: copy.title,
    description: copy.description,
    label: copy.label,
    href: action.destination.href,
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

/**
 * An offer read back from a response, or nothing.
 *
 * Checked against its own id, which encodes the scope, reason and target the
 * engine gave it: an offer whose parts disagree with its id would record
 * events against advice nobody gave. The link must stay inside the app.
 */
export function normalizeTutorPracticeOffer(value: unknown): TutorPracticeOffer | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const parsed = parseStudyActionId(text(item.actionId));
  const target = item.target as Record<string, unknown> | undefined;
  const title = text(item.title);
  const description = text(item.description);
  const label = text(item.label);
  const href = typeof item.href === "string" ? item.href.trim() : "";
  if (
    !parsed ||
    !target ||
    target.kind !== "topic" ||
    typeof target.topicKey !== "string" ||
    target.topicKey !== parsed.targetKey ||
    !TOPIC_SOURCES.includes(target.source as LearningTopicSource) ||
    !title ||
    !label ||
    !href.startsWith("/dashboard/") ||
    href.startsWith("//") ||
    href.length > 2_000
  ) {
    return undefined;
  }
  return {
    actionId: parsed.actionId,
    reason: parsed.reason,
    target: {
      kind: "topic",
      topicKey: parsed.targetKey,
      label: text(target.label) || title,
      source: target.source as LearningTopicSource,
    },
    scope: {
      ...(parsed.folderId ? { folderId: parsed.folderId } : {}),
      ...(parsed.deckId ? { deckId: parsed.deckId } : {}),
    },
    title,
    description,
    label,
    href,
  };
}
