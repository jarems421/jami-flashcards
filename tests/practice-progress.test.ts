import { describe, expect, it } from "vitest";
import type { ExamSession } from "@/lib/practice/exam-questions";
import type { PracticePaperAttempt } from "@/lib/practice/practice-papers";
import {
  summarisePaperAttempts,
  summarisePastPaperSessions,
  summarisePracticeWeek,
  summariseSessionTrend,
} from "@/lib/practice/practice-progress";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 14, 12);

function session(overrides: Partial<ExamSession>): ExamSession {
  return {
    id: "s",
    status: "completed",
    answeredCount: 5,
    awardedTotal: 10,
    maxTotal: 20,
    updatedAt: NOW,
    course: { qualification: "GCSE", specificationTitle: "Biology" },
    ...overrides,
  } as ExamSession;
}

function attempt(id: string, percentage: number, overrides: Partial<PracticePaperAttempt> = {}): PracticePaperAttempt {
  return {
    id,
    paperTitle: `Paper ${id}`,
    status: "marked",
    markedAt: NOW,
    result: { percentage, awardedMarks: percentage, totalMarks: 100, priorities: [], strengths: [] },
    ...overrides,
  } as PracticePaperAttempt;
}

describe("past paper question progress", () => {
  it("adds up marks across sessions and scores an unfinished one against what was marked", () => {
    const summary = summarisePastPaperSessions([
      session({ id: "done", awardedTotal: 15, maxTotal: 20 }),
      // Two questions marked so far, worth 8 marks, of a 30-mark session.
      session({ id: "going", status: "active", answeredCount: 2, awardedTotal: 5, maxTotal: 30, assessedTotal: 8 }),
    ]);

    expect(summary.questionsMarked).toBe(7);
    expect(summary.marksAwarded).toBe(20);
    expect(summary.marksAvailable).toBe(28);
    expect(summary.percent).toBe(71);
    expect(summary.finishedSessions).toBe(1);
  });

  it("ranks courses by how much was practised, and ignores sessions with nothing marked", () => {
    const summary = summarisePastPaperSessions([
      session({ answeredCount: 3, awardedTotal: 6, maxTotal: 12 }),
      session({
        answeredCount: 9,
        awardedTotal: 27,
        maxTotal: 30,
        course: { qualification: "GCSE", specificationTitle: "Chemistry" } as unknown as ExamSession["course"],
      }),
      session({ status: "active", answeredCount: 0, awardedTotal: 0, maxTotal: 40 }),
    ]);

    expect(summary.courses.map((course) => course.questionsMarked)).toEqual([9, 3]);
    expect(summary.courses[0].percent).toBe(90);
    expect(summary.courses[1].percent).toBe(50);
    expect(summary.sessionCount).toBe(3);
  });

  it("has no score before anything is marked", () => {
    expect(summarisePastPaperSessions([]).percent).toBeNull();
    expect(summarisePastPaperSessions([session({ status: "active", answeredCount: 0, awardedTotal: 0 })]).percent).toBeNull();
  });
});

describe("the recent-sessions trend", () => {
  it("draws sessions oldest first and compares the latest five with the five before", () => {
    // Ten sessions a day apart: 50% rising by 4 points each.
    const sessions = Array.from({ length: 10 }, (_, index) =>
      session({ id: `s${index}`, awardedTotal: 10 + index * 0.8, maxTotal: 20, updatedAt: NOW - (9 - index) * DAY_MS })
    );
    const trend = summariseSessionTrend([...sessions].reverse());

    expect(trend.points).toHaveLength(8);
    expect(trend.points[0].id).toBe("s2");
    expect(trend.points.at(-1)?.id).toBe("s9");
    expect(trend.recentCount).toBe(5);
    expect(trend.recentAverage).toBe(78);
    expect(trend.earlierAverage).toBe(58);
  });

  it("makes no comparison until there are earlier sessions to compare with", () => {
    const trend = summariseSessionTrend([session({ awardedTotal: 12, maxTotal: 20 })]);
    expect(trend.recentAverage).toBe(60);
    expect(trend.earlierAverage).toBeNull();
    expect(summariseSessionTrend([]).recentAverage).toBeNull();
  });
});

describe("the practice week", () => {
  it("counts sessions, marked papers and the separate days they happened on, in the last seven days", () => {
    const week = summarisePracticeWeek(
      [
        session({ updatedAt: NOW - 1 * DAY_MS }),
        session({ updatedAt: NOW - 1 * DAY_MS + 60_000 }),
        session({ updatedAt: NOW - 10 * DAY_MS }),
        session({ answeredCount: 0, updatedAt: NOW }),
      ],
      [attempt("a", 70, { markedAt: NOW - 3 * DAY_MS }), attempt("b", 60, { markedAt: NOW - 20 * DAY_MS })],
      NOW
    );

    expect(week).toEqual({ daysPractised: 2, sessions: 2, papersMarked: 1 });
  });
});

describe("practice paper progress", () => {
  it("averages, finds the best, and compares the two most recent papers", () => {
    const summary = summarisePaperAttempts([attempt("c", 72), attempt("b", 64.5), attempt("a", 80)]);

    expect(summary.markedCount).toBe(3);
    expect(summary.average).toBe(72);
    expect(summary.best).toBe(80);
    expect(summary.change).toBe(7.5);
    expect(summary.recent.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("makes no comparison from a single paper, and counts nothing unmarked", () => {
    const unmarked = { id: "x", status: "submitted" } as PracticePaperAttempt;
    const summary = summarisePaperAttempts([attempt("only", 55), unmarked]);

    expect(summary.markedCount).toBe(1);
    expect(summary.change).toBeNull();
    expect(summarisePaperAttempts([])).toMatchObject({ markedCount: 0, average: 0, best: 0, change: null });
  });

  it("passes on what the marker said about the latest paper, and nothing when it said nothing", () => {
    const latest = attempt("new", 70, {
      result: {
        percentage: 70,
        awardedMarks: 70,
        totalMarks: 100,
        priorities: ["Show units", "Label graph axes", "Use key terms", "Check rounding"],
        strengths: ["Clear method", "Good diagrams", "Neat layout"],
      } as PracticePaperAttempt["result"],
    });
    const summary = summarisePaperAttempts([latest, attempt("old", 60)]);

    expect(summary.latestFeedback).toEqual({
      paperTitle: "Paper new",
      priorities: ["Show units", "Label graph axes", "Use key terms"],
      strengths: ["Clear method", "Good diagrams"],
    });
    expect(summarisePaperAttempts([attempt("quiet", 50)]).latestFeedback).toBeNull();
  });

  it("shows how much extra time adds, only across papers marked both ways", () => {
    const summary = summarisePaperAttempts([
      attempt("t1", 70, { withinTimeResult: { percentage: 60 } as PracticePaperAttempt["result"] }),
      attempt("t2", 80, { withinTimeResult: { percentage: 74 } as PracticePaperAttempt["result"] }),
      attempt("untimed", 90),
    ]);

    expect(summary.extraTime).toEqual({ papers: 2, withinTime: 67, withExtraTime: 75 });
    expect(summarisePaperAttempts([attempt("untimed", 90)]).extraTime).toBeNull();
  });
});
