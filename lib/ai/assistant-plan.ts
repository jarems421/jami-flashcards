import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import {
  PLAN_WEEKDAYS,
  planScopeKey,
  type PlanWeekday,
  type RevisionPlanDraft,
  type RevisionPlanEmphasis,
} from "@/lib/planning/types";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

/**
 * A revision plan Jami drafted, read from what the model returned.
 *
 * The division of labour is enforced here rather than merely asked for in the
 * prompt. A model may set the *shape* of a week -- which subjects, how heavily,
 * which days, how long, until when -- and nothing else. There is no field in
 * this spec for a topic, a card, a paper or a task, so no amount of prompt
 * drift can produce a plan where a language model decided what a student should
 * study. That stays with the Learning Engine, which decides it from recorded
 * answers every time the plan is read.
 *
 * Subjects arrive as references (S1, S2) into a list the server supplied, never
 * as ids the model could invent and never as free text that would have to be
 * matched back by name. A reference that is not on the list is dropped.
 */

export const MAX_PLAN_SPEC_LENGTH = 4_000;

/**
 * What the server offers the model to choose between.
 *
 * More than a name, because the folder already knows more than a name. A
 * student who mentions English should not be asked which board they sit or
 * what they are reading -- their folder says AQA and the specification says
 * Macbeth, and an assistant that asks anyway is a form with a personality.
 *
 * All of it comes from the student's own folder and from checked specification
 * data. None of it is inferred, and none of it is evidence about what they know.
 */
export type PlanSubjectOption = {
  /** "S1", "S2", ... -- the only handle the model is given. */
  ref: string;
  label: string;
  folderId?: string;
  deckId?: string;
  /** The exam course this folder follows, as the student set it. */
  course?: string;
  /** GCSE, A level, and so on, where the folder says. */
  level?: string;
  /** Set texts the specification lists, where it lists any. */
  setTexts?: string[];
};

export type ParsedAssistantPlan = {
  draft: RevisionPlanDraft;
  /** Refs the model used that were not on offer. */
  unknownSubjects: string[];
};

function readWeekdays(value: unknown): PlanWeekday[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<PlanWeekday>();
  for (const raw of value) {
    const weekday = Number(raw);
    if (PLAN_WEEKDAYS.includes(weekday as PlanWeekday)) days.add(weekday as PlanWeekday);
  }
  return [...days].sort();
}

function readDayKey(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * The model's plan, or null if what came back does not read as one.
 *
 * Everything survives `normalizeRevisionPlanDraft` afterwards, so this only has
 * to get the shape across; the bounds are that function's job and it is the
 * same one the student's own builder goes through.
 */
export function parseAssistantPlanSpec(
  source: string,
  subjects: readonly PlanSubjectOption[],
  now = Date.now()
): ParsedAssistantPlan | null {
  const trimmed = source
    .trim()
    .replace(/^`{0,3}\s*(?:plan)?\s*(?=\{)/i, "")
    .replace(/\s*`{1,3}\s*$/, "");
  if (trimmed.length === 0 || trimmed.length > MAX_PLAN_SPEC_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const spec = parsed as Record<string, unknown>;

  const byRef = new Map(subjects.map((subject) => [subject.ref.toUpperCase(), subject]));
  const unknownSubjects: string[] = [];
  const scopes: RevisionPlanDraft["scopes"] = [];
  const emphasis: RevisionPlanEmphasis[] = [];

  const rawSubjects = Array.isArray(spec.subjects) ? spec.subjects : [];
  for (const raw of rawSubjects) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const ref = typeof entry.ref === "string" ? entry.ref.trim().toUpperCase() : "";
    const subject = byRef.get(ref);
    if (!subject) {
      if (ref) unknownSubjects.push(ref);
      continue;
    }
    const weight = Number(entry.weight);
    const scope = subject.folderId
      ? { folderId: subject.folderId, weight: Number.isFinite(weight) ? weight : 1 }
      : { deckId: subject.deckId as string, weight: Number.isFinite(weight) ? weight : 1 };
    scopes.push(scope);

    /*
     * "Start by finding out" versus "keep practising" is the only thing the
     * model may say about content, and it is not a claim about what the student
     * knows -- it decides where a diagnosis goes first. The engine then learns
     * the truth from what they actually get right.
     */
    if (entry.start === "diagnose" || entry.start === "practice") {
      emphasis.push({ scopeKey: planScopeKey(scope), wants: entry.start });
    }
  }

  const today = getStudyDayKey(now);
  const startDayKey = readDayKey(spec.start) ?? today;
  const endDayKey = readDayKey(spec.end) ?? shiftStudyDayKey(startDayKey, 27);
  const minutes = Number(spec.minutes);
  const weekdays = readWeekdays(spec.days);

  const { draft } = normalizeRevisionPlanDraft(
    {
      title: typeof spec.title === "string" ? spec.title : "Revision plan",
      status: "active",
      origin: "tutor",
      startDayKey,
      endDayKey,
      scopes,
      cadence: weekdays.map((weekday) => ({
        weekday,
        minutes: Number.isFinite(minutes) ? minutes : 45,
      })),
      emphasis,
    },
    now
  );

  return { draft, unknownSubjects };
}

/**
 * What the Learning Engine has noticed, in the words the student will read.
 *
 * Built from study actions rather than written by the model, and that is the
 * point: the line "you have been slipping on this" has to be true, and the only
 * thing entitled to say it is the thing that counted the answers. The model is
 * shown this and may refer to it; it is never asked to produce it.
 */
export type PlanNotice = {
  scopeKey: string;
  subject: string;
  /** A short phrase, already safe to read aloud. */
  detail: string;
  reason: StudyAction["reason"];
};

const NOTICE_PHRASES: Partial<Record<StudyAction["reason"], (label: string) => string>> = {
  persistent_error: (label) => `${label} keeps costing marks`,
  declining_mastery: (label) => `${label} has been slipping`,
  knowledge_decay: (label) => `${label} is fading since you last did it`,
  low_mastery: (label) => `${label} is not solid yet`,
  low_confidence: (label) => `${label} needs more evidence either way`,
  due_for_retrieval: (label) => `${label} has cards due`,
  recent_improvement_needs_reinforcement: (label) => `${label} is improving and worth locking in`,
  untested_exposure: (label) => `${label} has been covered but never tested`,
  not_yet_assessed: (label) => `${label} has not been looked at yet`,
};

/** The most notices one subject contributes, so no folder crowds out the rest. */
export const MAX_NOTICES_PER_SUBJECT = 2;
export const MAX_PLAN_NOTICES = 6;

export function buildPlanNotices(
  actions: readonly StudyAction[],
  subjectNames: ReadonlyMap<string, string>
): PlanNotice[] {
  const perSubject = new Map<string, number>();
  const notices: PlanNotice[] = [];

  for (const action of actions) {
    if (notices.length >= MAX_PLAN_NOTICES) break;
    const phrase = NOTICE_PHRASES[action.reason];
    if (!phrase || action.target.kind !== "topic") continue;
    const scopeKey = planScopeKey(action.scope);
    const used = perSubject.get(scopeKey) ?? 0;
    if (used >= MAX_NOTICES_PER_SUBJECT) continue;
    perSubject.set(scopeKey, used + 1);
    notices.push({
      scopeKey,
      subject: subjectNames.get(scopeKey) ?? "Your work",
      detail: phrase(action.target.label),
      reason: action.reason,
    });
  }
  return notices;
}
