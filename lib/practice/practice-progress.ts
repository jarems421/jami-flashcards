import { examCourseName } from "@/lib/practice/exam-course-names";
import type { ExamSession } from "@/lib/practice/exam-questions";
import type { PracticePaperAttempt } from "@/lib/practice/practice-papers";
import { getStudyDayKey } from "@/lib/study/day";

/**
 * How practice is going, for Progress: past paper questions and practice
 * papers, each summarised in numbers and sentences a student can read at a
 * glance.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Courses worth naming before the list becomes a table. */
const COURSE_LIMIT = 3;
/** Recent papers worth listing. */
const RECENT_PAPER_LIMIT = 3;
/** Sessions drawn in the recent-sessions chart. */
const TREND_LIMIT = 8;
/** How many sessions each side of the comparison averages. */
const TREND_WINDOW = 5;

export type PastPaperCourseProgress = {
  name: string;
  questionsMarked: number;
  percent: number;
};

export type PastPaperProgress = {
  sessionCount: number;
  finishedSessions: number;
  questionsMarked: number;
  marksAwarded: number;
  marksAvailable: number;
  /** Null until a single mark has been given. */
  percent: number | null;
  courses: PastPaperCourseProgress[];
};

/**
 * The marks a session can fairly be scored against.
 *
 * An unfinished session is scored against what has actually been marked, as
 * Practice history does: against the whole paper, one perfect answer out of
 * five questions read as 20%.
 */
function sessionMarksAvailable(session: ExamSession) {
  return session.status === "completed"
    ? session.maxTotal
    : session.assessedTotal ?? session.maxTotal;
}

function averageOf(values: number[]) {
  return values.length > 0
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : null;
}

export function summarisePastPaperSessions(sessions: readonly ExamSession[]): PastPaperProgress {
  const courses = new Map<string, { questionsMarked: number; awarded: number; available: number }>();
  let questionsMarked = 0;
  let marksAwarded = 0;
  let marksAvailable = 0;

  for (const session of sessions) {
    if (session.answeredCount <= 0) continue;
    const available = sessionMarksAvailable(session);
    questionsMarked += session.answeredCount;
    marksAwarded += session.awardedTotal;
    marksAvailable += available;

    const name = examCourseName(session.course);
    const course = courses.get(name) ?? { questionsMarked: 0, awarded: 0, available: 0 };
    course.questionsMarked += session.answeredCount;
    course.awarded += session.awardedTotal;
    course.available += available;
    courses.set(name, course);
  }

  return {
    sessionCount: sessions.length,
    finishedSessions: sessions.filter((session) => session.status === "completed").length,
    questionsMarked,
    marksAwarded,
    marksAvailable,
    percent: marksAvailable > 0 ? Math.round((marksAwarded / marksAvailable) * 100) : null,
    courses: [...courses.entries()]
      .filter(([, course]) => course.available > 0)
      .map(([name, course]) => ({
        name,
        questionsMarked: course.questionsMarked,
        percent: Math.round((course.awarded / course.available) * 100),
      }))
      .sort((left, right) => right.questionsMarked - left.questionsMarked)
      .slice(0, COURSE_LIMIT),
  };
}

export type SessionTrendPoint = {
  id: string;
  courseName: string;
  percent: number;
  at: number;
};

export type SessionTrend = {
  /** Oldest first, so the chart reads left to right. */
  points: SessionTrendPoint[];
  /** Average of the latest few sessions. */
  recentAverage: number | null;
  recentCount: number;
  /** Average of the few before those, or null when there are not yet any. */
  earlierAverage: number | null;
};

/** Each scored session's percentage over time, and whether the latest few moved. */
export function summariseSessionTrend(sessions: readonly ExamSession[]): SessionTrend {
  const scored = sessions
    .filter((session) => session.answeredCount > 0 && sessionMarksAvailable(session) > 0)
    .map((session) => ({
      id: session.id,
      courseName: examCourseName(session.course),
      percent: Math.round((session.awardedTotal / sessionMarksAvailable(session)) * 100),
      at: session.completedAt ?? session.updatedAt,
    }))
    .sort((left, right) => left.at - right.at);

  const recent = scored.slice(-TREND_WINDOW);
  const earlier = scored.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
  return {
    points: scored.slice(-TREND_LIMIT),
    recentAverage: averageOf(recent.map((point) => point.percent)),
    recentCount: recent.length,
    earlierAverage: averageOf(earlier.map((point) => point.percent)),
  };
}

export type PracticeWeek = {
  daysPractised: number;
  sessions: number;
  papersMarked: number;
};

/**
 * The last seven days of marked practice.
 *
 * A session only records when it was last worked on, so a session spread over
 * several days counts as one of them -- this can undercount days, never invent
 * them.
 */
export function summarisePracticeWeek(
  sessions: readonly ExamSession[],
  attempts: readonly PracticePaperAttempt[],
  now = Date.now()
): PracticeWeek {
  const since = now - 7 * DAY_MS;
  const days = new Set<string>();
  const recentSessions = sessions.filter(
    (session) => session.answeredCount > 0 && session.updatedAt >= since
  );
  recentSessions.forEach((session) => days.add(getStudyDayKey(session.updatedAt)));
  const recentPapers = attempts.filter(
    (attempt) => attempt.result && typeof attempt.markedAt === "number" && attempt.markedAt >= since
  );
  recentPapers.forEach((attempt) => days.add(getStudyDayKey(attempt.markedAt as number)));

  return {
    daysPractised: days.size,
    sessions: recentSessions.length,
    papersMarked: recentPapers.length,
  };
}

export type PaperFeedback = {
  paperTitle: string;
  priorities: string[];
  strengths: string[];
};

export type PaperExtraTime = {
  papers: number;
  /** Average score counting only what was written inside the time. */
  withinTime: number;
  /** Average final score, extra time included. */
  withExtraTime: number;
};

export type PaperProgress = {
  markedCount: number;
  average: number;
  best: number;
  /** Percentage points between the two most recent papers; null with fewer than two. */
  change: number | null;
  recent: PracticePaperAttempt[];
  /** What the marker said to work on, and what went well, on the latest paper. */
  latestFeedback: PaperFeedback | null;
  /** How much extra time is adding, across timed papers marked both ways. */
  extraTime: PaperExtraTime | null;
};

/** Takes attempts newest first, as `getRecentPracticePaperAttempts` returns them. */
export function summarisePaperAttempts(attempts: readonly PracticePaperAttempt[]): PaperProgress {
  const marked = attempts.filter((attempt) => attempt.result);
  const percentages = marked.map((attempt) => attempt.result!.percentage);

  const latest = marked[0];
  const priorities = latest?.result?.priorities.slice(0, 3) ?? [];
  const strengths = latest?.result?.strengths.slice(0, 2) ?? [];

  const timed = marked.filter((attempt) => attempt.withinTimeResult);
  const extraTime: PaperExtraTime | null =
    timed.length > 0
      ? {
          papers: timed.length,
          withinTime: averageOf(timed.map((attempt) => attempt.withinTimeResult!.percentage)) ?? 0,
          withExtraTime: averageOf(timed.map((attempt) => attempt.result!.percentage)) ?? 0,
        }
      : null;

  return {
    markedCount: marked.length,
    average: averageOf(percentages) ?? 0,
    best: percentages.length > 0 ? Math.max(...percentages) : 0,
    change:
      percentages.length > 1 ? Math.round((percentages[0] - percentages[1]) * 10) / 10 : null,
    recent: marked.slice(0, RECENT_PAPER_LIMIT),
    latestFeedback:
      latest && (priorities.length > 0 || strengths.length > 0)
        ? { paperTitle: latest.paperTitle, priorities, strengths }
        : null,
    extraTime,
  };
}
