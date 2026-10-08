import { describe, expect, it } from "vitest";
import {
  getMinutesIntoLocalDay,
  getMsUntilNextStudyBoundary,
  getStudyDayKey,
  getStudyDayWindow,
  isKnownTimeZone,
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

describe("a student's own clock", () => {
  it("reads the time of day where the student is", () => {
    expect(getMinutesIntoLocalDay(londonSummer(9, 16, 30))).toBe(16 * 60 + 30);
    expect(getMinutesIntoLocalDay(Date.UTC(2026, 9, 9, 11, 0), "Asia/Kolkata")).toBe(16 * 60 + 30);
    expect(getMinutesIntoLocalDay(Date.UTC(2026, 9, 9, 20, 0), "America/New_York")).toBe(16 * 60);
  });

  it("keeps the student's own days apart from study time", () => {
    // 01:00 on Saturday in London is still Friday's study day; in Tokyo it is Saturday morning.
    expect(getStudyDayKey(londonSummer(10, 1))).toBe("2026-10-09");
    expect(getStudyDayKey(londonSummer(10, 1), "Asia/Tokyo")).toBe("2026-10-10");
  });

  it("knows a real time zone from anything else", () => {
    expect(isKnownTimeZone("Europe/London")).toBe(true);
    expect(isKnownTimeZone("Asia/Kolkata")).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
    expect(isKnownTimeZone(42)).toBe(false);
  });
});
