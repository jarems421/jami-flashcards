import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} from "@/lib/app/notifications";

describe("notification helpers", () => {
  it("falls back when updatedAt is not a finite number", () => {
    expect(
      normalizeNotificationPreferences({
        updatedAt: Number.POSITIVE_INFINITY,
      })
    ).toMatchObject({
      updatedAt: DEFAULT_NOTIFICATION_PREFERENCES.updatedAt,
    });

    expect(
      normalizeNotificationPreferences({
        updatedAt: Number.NaN,
      })
    ).toMatchObject({
      updatedAt: DEFAULT_NOTIFICATION_PREFERENCES.updatedAt,
    });
  });

  it("keeps valid digest metadata when preference data is normalized", () => {
    expect(
      normalizeNotificationPreferences({
        enabled: false,
        dueCardDigest: false,
        goalDigest: false,
        dailyNudge: true,
        timezone: "America/New_York",
        updatedAt: 123,
        lastDigestDayKey: "2026-04-04",
        lastDigestSentAt: 456,
      })
    ).toEqual({
      enabled: false,
      mode: "always",
      updatedAt: 123,
      lastDigestStudyDayKey: "2026-04-04",
      lastDigestSentAt: 456,
    });
  });
});
