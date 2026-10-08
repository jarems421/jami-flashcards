import { describe, expect, it } from "vitest";
import {
  getMsUntilNextStudyBoundary,
  getStudyDayKey,
  getStudyDayWindow,
  isWithinDailyDigestWindow,
} from "@/lib/study/day";

// Friday 9 October 2026 is in British Summer Time (UTC+1); Friday 11 December
// 2026 is in GMT (UTC+0).
const londonSummer = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour - 1, minute);
const londonWinter = (day: number, hour: number, minute = 0) => Date.UTC(2026, 11, day, hour, minute);

describe("the study day", () => {
  it("is the date the student sees once the morning starts", () => {
    expect(getStudyDayKey(londonSummer(9, 10))).toBe("2026-10-09");
    expect(getStudyDayKey(londonSummer(9, 15, 59))).toBe("2026-10-09");
    expect(getStudyDayKey(londonWinter(11, 10))).toBe("2026-12-11");
  });

  it("keeps a session that runs past midnight on the evening it started in", () => {
    expect(getStudyDayKey(londonSummer(10, 1, 30))).toBe("2026-10-09");
    expect(getStudyDayKey(londonSummer(10, 3, 59))).toBe("2026-10-09");
  });

  it("turns over at 4am", () => {
    expect(getStudyDayKey(londonSummer(10, 4))).toBe("2026-10-10");
    expect(getStudyDayWindow(londonSummer(9, 12))).toEqual({
      studyDayKey: "2026-10-09",
      start: londonSummer(9, 4),
      end: londonSummer(10, 4),
    });
    expect(getMsUntilNextStudyBoundary(londonSummer(10, 3))).toBe(60 * 60 * 1000);
  });
});

describe("the daily nudge window", () => {
  const twentyMinutes = 20 * 60 * 1000;

  it("opens at 4pm London in summer and in winter", () => {
    expect(isWithinDailyDigestWindow(londonSummer(9, 16, 5), twentyMinutes)).toBe(true);
    expect(isWithinDailyDigestWindow(londonWinter(11, 16, 5), twentyMinutes)).toBe(true);
  });

  it("is shut before 4pm and once the window has passed", () => {
    expect(isWithinDailyDigestWindow(londonSummer(9, 15, 59), twentyMinutes)).toBe(false);
    expect(isWithinDailyDigestWindow(londonSummer(9, 16, 21), twentyMinutes)).toBe(false);
    expect(isWithinDailyDigestWindow(londonSummer(9, 4), twentyMinutes)).toBe(false);
  });

  it("matches the two cron runs: 15:00 UTC in summer, 16:00 UTC in winter", () => {
    expect(isWithinDailyDigestWindow(Date.UTC(2026, 9, 9, 15, 0), twentyMinutes)).toBe(true);
    expect(isWithinDailyDigestWindow(Date.UTC(2026, 9, 9, 16, 0), twentyMinutes)).toBe(false);
    expect(isWithinDailyDigestWindow(Date.UTC(2026, 11, 11, 16, 0), twentyMinutes)).toBe(true);
    expect(isWithinDailyDigestWindow(Date.UTC(2026, 11, 11, 15, 0), twentyMinutes)).toBe(false);
  });
});
