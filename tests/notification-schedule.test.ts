import { describe, expect, it } from "vitest";
import { getDueNudge } from "@/lib/app/notification-schedule";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "@/lib/app/notifications";

const preferences = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  ...overrides,
});

// Thursday 8 October 2026. London is on BST (UTC+1), New York on EDT (UTC-4),
// Kolkata is UTC+5:30.
const utc = (hour: number, minute = 0) => Date.UTC(2026, 9, 8, hour, minute);

describe("getDueNudge", () => {
  it("sends the digest at 4pm London by default, and not before", () => {
    expect(getDueNudge(preferences(), utc(14, 59))).toBeNull();
    expect(getDueNudge(preferences(), utc(15, 5))).toEqual({ kind: "digest", dayKey: "2026-10-08" });
  });

  it("sends it at 4pm in the student's own time zone", () => {
    const newYork = preferences({ timeZone: "America/New_York" });
    expect(getDueNudge(newYork, utc(15, 5))).toBeNull();
    expect(getDueNudge(newYork, utc(20, 5))).toEqual({ kind: "digest", dayKey: "2026-10-08" });
  });

  it("reaches a student half an hour off the hour on the first run after 4pm", () => {
    const kolkata = preferences({ timeZone: "Asia/Kolkata" });
    expect(getDueNudge(kolkata, utc(10, 0))).toBeNull(); // 15:30 there
    expect(getDueNudge(kolkata, utc(11, 0))).toEqual({ kind: "digest", dayKey: "2026-10-08" }); // 16:30
  });

  it("sends the digest once a day, then the evening reminder after 7pm", () => {
    const sentToday = preferences({ lastDigestStudyDayKey: "2026-10-08" });
    expect(getDueNudge(sentToday, utc(16, 5))).toBeNull(); // 17:05 London
    expect(getDueNudge(sentToday, utc(18, 5))).toEqual({ kind: "evening", dayKey: "2026-10-08" }); // 19:05
    expect(
      getDueNudge(preferences({ lastDigestStudyDayKey: "2026-10-08", lastEveningReminderDayKey: "2026-10-08" }), utc(19, 5))
    ).toBeNull();
  });

  it("leaves the evening reminder out for a student who turned it off", () => {
    expect(
      getDueNudge(preferences({ lastDigestStudyDayKey: "2026-10-08", eveningReminder: false }), utc(18, 5))
    ).toBeNull();
  });

  it("still sends a digest missed in the afternoon, ahead of the evening reminder", () => {
    expect(getDueNudge(preferences(), utc(18, 30))).toEqual({ kind: "digest", dayKey: "2026-10-08" });
  });

  it("sends nothing from 10pm, and nothing when notifications are off", () => {
    expect(getDueNudge(preferences(), utc(21, 5))).toBeNull(); // 22:05 London
    expect(getDueNudge(preferences({ enabled: false }), utc(15, 5))).toBeNull();
  });
});
