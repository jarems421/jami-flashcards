import type { StudyActionEvent } from "@/lib/learning/events/study-action-event";
import type { LearningRecommendationEvidence } from "@/lib/learning/types";

/**
 * When advice already given should stop being given again.
 *
 * Two rules, and both are about the same thing: advice that keeps reappearing
 * unchanged stops being read. Today shows four actions, so one stale entry is
 * a quarter of the surface.
 *
 * **Acted on, and nothing new since.** A student who studies a topic has done
 * what was asked. The recommendation rests until evidence newer than the work
 * arrives -- which, because studying *is* evidence, normally means until the
 * profile has seen the result and reached its own new decision. Resting on
 * "newer evidence" rather than on a fixed number of days is what keeps this
 * from hiding a topic the student is still getting wrong.
 *
 * **Dismissed, repeatedly.** Dismissing once is a mood. Dismissing the same
 * advice three times is information the evidence does not contain -- they have
 * a reason, whether or not Jami can see it -- so it goes quiet for a fortnight
 * and then may be raised once more.
 *
 * Neither rule deletes anything. A suppressed recommendation is still in the
 * profile with its evidence intact; it is only kept off the surface, and a
 * caller that wants the full list can have it.
 */

/** Dismissals of the same action before it goes quiet. */
export const DISMISSALS_BEFORE_COOLDOWN = 3;
/** How long a repeatedly dismissed action rests, in days. */
export const DISMISSAL_COOLDOWN_DAYS = 14;
/**
 * The longest an acted-on action rests without new evidence.
 *
 * A backstop, not the main rule. Work that leaves no evidence the profile can
 * read -- reading a source, opening a topic page -- would otherwise silence a
 * real weakness indefinitely.
 */
export const COMPLETION_COOLDOWN_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActionHistory = {
  /** The most recent `started` or `completed`, if any. */
  lastActedAt?: number;
  dismissals: number;
  lastDismissedAt?: number;
};

/** Group a student's raw events by the action they are about. */
export function summariseActionHistory(
  events: readonly StudyActionEvent[]
): Map<string, ActionHistory> {
  const byAction = new Map<string, ActionHistory>();
  for (const event of events) {
    const current = byAction.get(event.actionId) ?? { dismissals: 0 };
    if (event.outcome === "started" || event.outcome === "completed") {
      current.lastActedAt = Math.max(current.lastActedAt ?? 0, event.at);
    } else if (event.outcome === "dismissed") {
      current.dismissals += 1;
      current.lastDismissedAt = Math.max(current.lastDismissedAt ?? 0, event.at);
    }
    byAction.set(event.actionId, current);
  }
  return byAction;
}

export type CooldownReason = "acted_on" | "dismissed";

/**
 * Whether this action should be held back now, and why.
 *
 * `lastEvidenceAt` is the newest evidence behind the recommendation. Evidence
 * recorded after the student acted is the signal that the loop has turned and
 * the engine is speaking from something new, so the rest ends there.
 */
export function actionCooldown(
  history: ActionHistory | undefined,
  evidence: Pick<LearningRecommendationEvidence, "lastEvidenceAt">,
  now: number
): CooldownReason | null {
  if (!history) return null;

  if (
    history.dismissals >= DISMISSALS_BEFORE_COOLDOWN &&
    history.lastDismissedAt !== undefined &&
    now - history.lastDismissedAt < DISMISSAL_COOLDOWN_DAYS * DAY_MS
  ) {
    return "dismissed";
  }

  if (history.lastActedAt !== undefined) {
    const evidenceIsNewer =
      evidence.lastEvidenceAt !== undefined && evidence.lastEvidenceAt > history.lastActedAt;
    const expired = now - history.lastActedAt >= COMPLETION_COOLDOWN_DAYS * DAY_MS;
    if (!evidenceIsNewer && !expired) return "acted_on";
  }

  return null;
}
