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

export const REVISION_PLAN_SCHEMA_VERSION = 1;

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

/** The shortest and longest a session may be, in minutes. */
export const PLAN_MINUTES_MIN = 10;
export const PLAN_MINUTES_MAX = 240;
/** Roughly how long one thing takes, used to decide how many fit in a session. */
export const PLAN_MINUTES_PER_ITEM = 15;
/** However long the session, more than this in one sitting is a list, not a plan. */
export const PLAN_MAX_ITEMS_PER_DAY = 4;
/** How far ahead a plan may run. Longer than a school year is a mistake, not a plan. */
export const PLAN_MAX_HORIZON_DAYS = 400;

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

export type RevisionPlanCadence = {
  weekday: PlanWeekday;
  minutes: number;
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
  cadence: RevisionPlanCadence[];
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

export type PlanDay = {
  planId: string;
  dayKey: string;
  /** Whether the plan calls for any study at all on this day. */
  scheduled: boolean;
  skipped: boolean;
  minutes: number;
  slots: PlanSlot[];
  doneCount: number;
};

/** A scope key that reads the same wherever it is built. */
export function planScopeKey(scope: Pick<RevisionPlanScope, "folderId" | "deckId">) {
  if (scope.folderId) return `folder:${scope.folderId}`;
  if (scope.deckId) return `deck:${scope.deckId}`;
  return "none";
}
