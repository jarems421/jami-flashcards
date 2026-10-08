import type { NotificationPreferences } from "@/lib/app/notifications";
import { getMinutesIntoLocalDay, getStudyDayKey, getStudyTimeZone } from "@/lib/study/day";

/** The daily nudge: after school, at 4pm where the student is. */
export const DIGEST_LOCAL_MINUTE = 16 * 60;
/** The evening reminder, while Daily Review is still waiting: 7pm. */
export const EVENING_REMINDER_LOCAL_MINUTE = 19 * 60;
/** Nothing is sent from 10pm until the next afternoon. */
export const QUIET_FROM_LOCAL_MINUTE = 22 * 60;

export type NudgeKind = "digest" | "evening";

export type DueNudge = {
  kind: NudgeKind;
  /** The student's own day the nudge belongs to; at most one of each kind per day. */
  dayKey: string;
};

/**
 * Which nudge, if any, a student is owed at `now`, by their own clock.
 *
 * The digest runs hourly, so each nudge goes on the first run after its time
 * rather than at an exact minute: the schedule's hour can drift, and a student
 * half an hour off the hour (India, parts of Australia) is still reached. A
 * nudge that was not sent by 10pm waits for the next day.
 */
export function getDueNudge(preferences: NotificationPreferences, now: number): DueNudge | null {
  if (!preferences.enabled) return null;
  const timeZone = preferences.timeZone ?? getStudyTimeZone();
  const minutes = getMinutesIntoLocalDay(now, timeZone);
  if (minutes < DIGEST_LOCAL_MINUTE || minutes >= QUIET_FROM_LOCAL_MINUTE) return null;

  const dayKey = getStudyDayKey(now, timeZone);
  if (preferences.lastDigestStudyDayKey !== dayKey) return { kind: "digest", dayKey };
  if (
    preferences.eveningReminder &&
    minutes >= EVENING_REMINDER_LOCAL_MINUTE &&
    preferences.lastEveningReminderDayKey !== dayKey
  ) {
    return { kind: "evening", dayKey };
  }
  return null;
}
