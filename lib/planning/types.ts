import type { StudyAction } from "@/lib/learning/actions/study-actions";

/**
 * A revision plan: the shape of a student's own week, filled by the Learning
 * Engine.
 *
 * The division of labour matters more here than anywhere else in the feature.
 * The plan owns *when* a student studies and *how much* -- days, session
 * lengths, which subjects, how heavily each. The Learning Engine owns *what*
 * they do in that time, and it decides that from recorded evidence alone. A
 * plan therefore stores almost nothing about content: it is a timetable that
 * asks the engine what goes in each slot every time it is read.
 *
 * That is what keeps a plan from going stale. A plan written out as six weeks
 * of fixed tasks is wrong within a week -- the student learns some of it, fails
 * at some of it, and the list knows neither. A plan that is a shape plus a live
 * question re-answers itself every morning.
 *
 * Nothing in here is learner evidence. Ticking a slot says a student believes
 * they did something, which is not the same as knowing it, and it must never
 * reach the learner profile. See `lib/learning/types.ts` for what may.
 */

/**
 * 2 is sessions; 1 was cadence.
 *
 * A version 1 plan carried one `{weekday, minutes}` entry per weekday and could
 * say nothing about clock times, about a second session in an evening, or about
 * which subject a particular sitting was for. Version 2 keeps every one of
 * those optional -- a migrated plan behaves identically -- but the shape can now
 * hold a real timetable. See `lib/planning/migrate-plan.ts`.
 */
export const REVISION_PLAN_SCHEMA_VERSION = 2;

/** Sunday first, matching `Date#getDay`. */
export const PLAN_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type PlanWeekday = (typeof PLAN_WEEKDAYS)[number];

export const PLAN_WEEKDAY_LABELS: Record<PlanWeekday, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export const PLAN_WEEKDAY_FULL_LABELS: Record<PlanWeekday, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

/** The shortest and longest a session may be, in minutes. */
export const PLAN_MINUTES_MIN = 10;
export const PLAN_MINUTES_MAX = 240;
/** Roughly how long one thing takes, used to decide how many fit in a session. */
export const PLAN_MINUTES_PER_ITEM = 15;
/** However long the session, more than this in one sitting is a list, not a plan. */
export const PLAN_MAX_ITEMS_PER_DAY = 4;
/**
 * How many sittings a day may hold, and how many pieces of work across all of
 * them.
 *
 * A day is allowed several sessions now, which means the old per-session cap no
 * longer bounds the day. Four sittings is already an unusual day; eight things
 * to do in one is the point past which a plan reads as a backlog.
 */
export const PLAN_MAX_SESSIONS_PER_DAY = 4;
export const PLAN_MAX_SLOTS_PER_DAY = 8;
/** How far ahead a plan may run. Longer than a school year is a mistake, not a plan. */
export const PLAN_MAX_HORIZON_DAYS = 400;

/** A wall-clock time of day, 24 hour, as it is written. Never a timestamp. */
export const PLAN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One subject the plan covers, and how much of it that subject takes.
 *
 * Scoped to a folder or a deck because that is what the Learning Engine scopes
 * a profile to -- there is no account-wide model to draw on, by design.
 */
export type RevisionPlanScope = {
  folderId?: string;
  deckId?: string;
  /** 1 to 3. Relative, not absolute: two subjects at 3 share the time evenly. */
  weight: number;
};

/**
 * One sitting in the student's week.
 *
 * Everything past `weekday` and `minutes` is optional, and that is the whole
 * design. A student who wants to say only "Mondays, 45 minutes" writes exactly
 * what version 1 wrote. A student who wants a timetable can say "Monday 16:30,
 * 45 minutes, Chemistry" and then "Monday 18:00, 30 minutes" as well. Neither
 * is the real one; the plan carries however much they chose to tell it.
 *
 * `startTime` is a time of day as written -- "16:30" -- and never a moment. A
 * plan that said Monday at half four should say that wherever it is read, and
 * putting it through a timestamp would make it depend on a timezone it has
 * nothing to do with. It orders the day and it prints; nothing schedules on it.
 */
export type RevisionPlanSession = {
  /**
   * Stable across edits, so a session keeps its identity while it is being
   * moved, renamed or re-timed. Slot ids are positional and do not use this --
   * see `planSlotId` -- so changing it cannot orphan a student's ticks.
   */
  id: string;
  weekday: PlanWeekday;
  minutes: number;
  /** "HH:MM", 24 hour. Absent means a sitting with no fixed time. */
  startTime?: string;
  /**
   * Pins this sitting to one subject.
   *
   * Absent means the plan's weighting decides, which is what every version 1
   * plan does. Present means the student said "Monday evening is Chemistry",
   * and the engine still chooses what inside Chemistry.
   */
  scopeKey?: string;
  /** The student's own name for it, e.g. "After dinner". */
  label?: string;
};

/**
 * What a student said they want from a subject, in their own words.
 *
 * A self-report is not evidence of what somebody knows -- it is a feeling, and
 * letting it into the learner profile would corrupt the one thing that model is
 * careful about. What it can honestly do is decide where to *look* first: a
 * subject the student is worried about opens with diagnosis, and the engine
 * then learns the truth from what they actually get right.
 *
 * `note` is kept so the student can read back what they told Jami. It is never
 * sent to the profile and never used to score anything.
 */
export type RevisionPlanEmphasis = {
  scopeKey: string;
  wants: "diagnose" | "practice";
  note?: string;
};

export type RevisionPlan = {
  id: string;
  schemaVersion: number;
  title: string;
  status: "active" | "archived";
  /** Whether Jami drafted it or the student built it themselves. */
  origin: "tutor" | "manual";
  startDayKey: string;
  endDayKey: string;
  scopes: RevisionPlanScope[];
  sessions: RevisionPlanSession[];
  emphasis: RevisionPlanEmphasis[];
  createdAt: number;
  updatedAt: number;
};

/** Everything a plan needs before it has an id or timestamps. */
export type RevisionPlanDraft = Omit<
  RevisionPlan,
  "id" | "createdAt" | "updatedAt" | "schemaVersion"
>;

/**
 * Something the student put in a particular day themselves.
 *
 * The href is stored rather than re-resolved because a pinned item is a
 * decision, not a recommendation: if the engine would no longer suggest it, the
 * student still asked for it.
 */
export type PinnedPlanItem = {
  actionId: string;
  label: string;
  href?: string;
};

/**
 * What the student changed about one day. Days they left alone store nothing.
 *
 * A plan of six weeks is six weeks of documents if every day is written out,
 * and forty of them would say only "unchanged". The schedule is computed; this
 * holds the exceptions.
 */
export type RevisionPlanEntry = {
  dayKey: string;
  pinned?: PinnedPlanItem[];
  skipped?: boolean;
  /** Slot ids the student ticked by hand, for work Jami cannot see. */
  completedSlotIds?: string[];
  updatedAt?: number;
};

export type PlanSlotItem =
  | { kind: "action"; action: StudyAction }
  | { kind: "pinned"; pinned: PinnedPlanItem }
  /** Time set aside that the engine had nothing to put in. */
  | { kind: "open" };

export type PlanSlotState = "todo" | "done" | "skipped";

export type PlanSlot = {
  /** Stable for a given plan, day and position, so a tick survives a refresh. */
  id: string;
  position: number;
  minutes: number;
  scopeKey: string;
  item: PlanSlotItem;
  state: PlanSlotState;
  /**
   * How a done slot came to be done. `activity` means Jami saw the work;
   * `manual` means the student said so.
   */
  completedBy?: "activity" | "manual";
};

/**
 * One sitting as it is actually shown, with the work the engine put in it.
 *
 * The plan's session says when and how long; this says what came of it today.
 */
export type PlanDaySession = {
  /** The plan session this came from. */
  id: string;
  index: number;
  minutes: number;
  startTime?: string;
  /** Derived from `startTime` and `minutes`, for reading only. */
  endTime?: string;
  label?: string;
  /** The subject this sitting is for, whether pinned or decided by weighting. */
  scopeKey: string;
  slots: PlanSlot[];
  doneCount: number;
};

export type PlanDay = {
  planId: string;
  dayKey: string;
  /** Whether the plan calls for any study at all on this day. */
  scheduled: boolean;
  skipped: boolean;
  minutes: number;
  sessions: PlanDaySession[];
  /**
   * Every slot in the day, in order, across all of its sessions.
   *
   * Kept alongside `sessions` because completion, ticking and progress all work
   * on the day rather than on a sitting, and a caller that only wants "what is
   * left today" should not have to flatten it first.
   */
  slots: PlanSlot[];
  doneCount: number;
};

/** A scope key that reads the same wherever it is built. */
export function planScopeKey(scope: Pick<RevisionPlanScope, "folderId" | "deckId">) {
  if (scope.folderId) return `folder:${scope.folderId}`;
  if (scope.deckId) return `deck:${scope.deckId}`;
  return "none";
}
