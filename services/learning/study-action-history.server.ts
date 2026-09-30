import "server-only";

import {
  STUDY_ACTION_EVENTS_COLLECTION,
  decodeStudyActionEvent,
  type StudyActionEvent,
} from "@/lib/learning/events/study-action-event";
import {
  summariseActionHistory,
  type ActionHistory,
} from "@/lib/learning/actions/action-cooldown";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";

const log = createLogger({ route: "learning.study_action_history" });

/**
 * How much of a student's advice history one request reads.
 *
 * Only recent events can still be resting -- the longest cooldown is a
 * fortnight, the backstop three weeks -- so there is nothing to gain from
 * reading further back than a term. Bounded like every other profile read.
 */
export const STUDY_ACTION_HISTORY_LIMIT = 400;
export const STUDY_ACTION_HISTORY_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What has already become of this student's advice, by action id.
 *
 * Failure is not an error: a student with no history, an index still building,
 * or a read that times out all mean the same thing to the caller -- decide
 * from the evidence alone, which is what the engine did before any of this
 * existed. Returning an empty map rather than throwing is what keeps the
 * Learning Engine's rule that its own failures never cost a student their
 * home page.
 */
export async function loadStudyActionHistory(input: {
  uid: string;
  now?: number;
}): Promise<{ history: Map<string, ActionHistory>; available: boolean }> {
  const uid = input.uid.trim();
  if (!uid) return { history: new Map(), available: false };
  const since = (input.now ?? Date.now()) - STUDY_ACTION_HISTORY_DAYS * DAY_MS;

  try {
    const snapshot = await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection(STUDY_ACTION_EVENTS_COLLECTION)
      .where("at", ">=", since)
      .orderBy("at", "desc")
      .limit(STUDY_ACTION_HISTORY_LIMIT)
      .get();

    const events: StudyActionEvent[] = [];
    for (const document of snapshot.docs) {
      const event = decodeStudyActionEvent(document.id, document.data() as Record<string, unknown>);
      if (event) events.push(event);
    }
    return { history: summariseActionHistory(events), available: true };
  } catch (error) {
    log.warn("history.unavailable", { error });
    return { history: new Map(), available: false };
  }
}

/** The raw events, for the intervention evaluation rather than for cooldowns. */
export async function loadStudyActionEvents(input: {
  uid: string;
  limit?: number;
}): Promise<StudyActionEvent[]> {
  const uid = input.uid.trim();
  if (!uid) return [];
  try {
    const snapshot = await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection(STUDY_ACTION_EVENTS_COLLECTION)
      .orderBy("at", "desc")
      .limit(Math.max(1, input.limit ?? STUDY_ACTION_HISTORY_LIMIT))
      .get();
    return snapshot.docs.flatMap((document) => {
      const event = decodeStudyActionEvent(document.id, document.data() as Record<string, unknown>);
      return event ? [event] : [];
    });
  } catch (error) {
    log.warn("events.unavailable", { error });
    return [];
  }
}
