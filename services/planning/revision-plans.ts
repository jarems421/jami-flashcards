import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { migrateStoredRevisionPlan } from "@/lib/planning/migrate-plan";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import {
  REVISION_PLAN_SCHEMA_VERSION,
  type PinnedPlanItem,
  type RevisionPlan,
  type RevisionPlanDraft,
  type RevisionPlanEntry,
} from "@/lib/planning/types";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";

/**
 * Where a student's revision plans live.
 *
 * A plan is the student's own writing, not learner evidence: it says what they
 * intend to do, never what they know. Nothing here is read by the Learning
 * Engine, and a tick recorded here must never reach a learner profile -- see
 * `lib/planning/types.ts`.
 *
 * Only the days a student changed are stored. A six-week plan is forty-odd
 * days, and writing out the ones nobody touched would be forty documents
 * saying "unchanged".
 */

export const MAX_PLANS_PER_STUDENT = 8;

const plansPath = (uid: string) => collection(db, "users", uid, "revisionPlans");
const planPath = (uid: string, planId: string) => doc(db, "users", uid, "revisionPlans", planId);
const entriesPath = (uid: string, planId: string) =>
  collection(db, "users", uid, "revisionPlans", planId, "entries");
const entryPath = (uid: string, planId: string, dayKey: string) =>
  doc(db, "users", uid, "revisionPlans", planId, "entries", dayKey);

function readPlan(id: string, data: Record<string, unknown>): RevisionPlan {
  // Normalised on the way out as well as in: a document written by an older
  // build, or edited in the console, still has to come back as a usable plan.
  // Migrated first, so a version 1 `cadence` arrives as sessions rather than as
  // a plan with no days at all.
  const { draft } = normalizeRevisionPlanDraft(
    migrateStoredRevisionPlan(data) as Partial<RevisionPlanDraft>
  );
  return {
    ...draft,
    id,
    schemaVersion:
      typeof data.schemaVersion === "number" ? data.schemaVersion : REVISION_PLAN_SCHEMA_VERSION,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

function readEntry(dayKey: string, data: Record<string, unknown>): RevisionPlanEntry {
  const pinned = Array.isArray(data.pinned)
    ? (data.pinned as PinnedPlanItem[]).filter(
        (item) => item && typeof item.actionId === "string" && typeof item.label === "string"
      )
    : undefined;
  const completedSlotIds = Array.isArray(data.completedSlotIds)
    ? (data.completedSlotIds as unknown[]).filter((id): id is string => typeof id === "string")
    : undefined;
  return {
    dayKey,
    ...(pinned && pinned.length > 0 ? { pinned } : {}),
    ...(data.skipped === true ? { skipped: true } : {}),
    ...(completedSlotIds && completedSlotIds.length > 0 ? { completedSlotIds } : {}),
    ...(typeof data.updatedAt === "number" ? { updatedAt: data.updatedAt } : {}),
  };
}

/**
 * Today's plan as last read, kept on this device for the next launch.
 *
 * Today will not draw its first card until it knows whether there is a plan,
 * so the plan's two reads -- the plan, then its week -- sat in front of the
 * whole page on every launch, plan or none. The kept copy answers at once and
 * is read again behind it. Only the week it was read for is kept, and it comes
 * back through the same normalising as a stored document does.
 */
const STORED_TODAY_PLAN_PREFIX = "jami:today-plan:";
const STORED_TODAY_PLAN_VERSION = 1;

export type StoredTodayRevisionPlan = {
  plan: RevisionPlan | null;
  entries: RevisionPlanEntry[];
};

export function readStoredTodayRevisionPlan(
  uid: string,
  weekStartDayKey: string
): StoredTodayRevisionPlan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${STORED_TODAY_PLAN_PREFIX}${uid}`);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return null;
    const { version, weekStartDayKey: storedWeek, plan, entries } = stored as Record<string, unknown>;
    if (version !== STORED_TODAY_PLAN_VERSION || storedWeek !== weekStartDayKey) return null;
    if (!Array.isArray(entries)) return null;
    if (plan === null) return { plan: null, entries: [] };
    if (typeof plan !== "object" || typeof (plan as { id?: unknown }).id !== "string") {
      return null;
    }
    const planData = plan as Record<string, unknown>;
    return {
      plan: readPlan(planData.id as string, planData),
      entries: entries
        .filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null && typeof entry.dayKey === "string"
        )
        .map((entry) => readEntry(entry.dayKey as string, entry)),
    };
  } catch {
    return null;
  }
}

export function storeTodayRevisionPlan(
  uid: string,
  weekStartDayKey: string,
  value: StoredTodayRevisionPlan
) {
  try {
    window.localStorage.setItem(
      `${STORED_TODAY_PLAN_PREFIX}${uid}`,
      JSON.stringify({ version: STORED_TODAY_PLAN_VERSION, weekStartDayKey, ...value })
    );
  } catch {
    // Only a head start for the next launch.
  }
}

/** Forgets every kept plan on this device, at sign-out. */
export function clearStoredTodayRevisionPlans() {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(STORED_TODAY_PLAN_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage that cannot be read holds nothing to clear.
  }
}

export async function loadRevisionPlans(uid: string): Promise<RevisionPlan[]> {
  const snapshot = await getDocs(
    query(plansPath(uid), orderBy("updatedAt", "desc"), limit(MAX_PLANS_PER_STUDENT))
  );
  return snapshot.docs.map((entry) => readPlan(entry.id, entry.data()));
}

/**
 * The plan Today should show, or null.
 *
 * One active plan is shown at a time. Two timetables competing for the top of
 * Today is the thing the strip exists to prevent.
 */
export async function loadActiveRevisionPlan(uid: string): Promise<RevisionPlan | null> {
  const snapshot = await getDocs(
    query(plansPath(uid), where("status", "==", "active"), orderBy("updatedAt", "desc"), limit(1))
  );
  const first = snapshot.docs[0];
  return first ? readPlan(first.id, first.data()) : null;
}

export async function loadRevisionPlanEntries(
  uid: string,
  planId: string,
  options: { fromDayKey?: string; toDayKey?: string; max?: number } = {}
): Promise<RevisionPlanEntry[]> {
  const constraints = [
    ...(options.fromDayKey ? [where("dayKey", ">=", options.fromDayKey)] : []),
    ...(options.toDayKey ? [where("dayKey", "<=", options.toDayKey)] : []),
    orderBy("dayKey", "asc"),
    limit(Math.max(1, options.max ?? 120)),
  ];
  const snapshot = await getDocs(query(entriesPath(uid, planId), ...constraints));
  return snapshot.docs.map((entry) => readEntry(entry.id, entry.data()));
}

export async function saveRevisionPlan(
  uid: string,
  planId: string,
  draft: RevisionPlanDraft
): Promise<RevisionPlan> {
  const { draft: safe, valid } = normalizeRevisionPlanDraft(draft);
  if (!valid) throw new Error("This plan is missing something Jami needs.");
  const now = Date.now();
  await setDoc(
    planPath(uid, planId),
    {
      ...safe,
      // The draft leaves out an empty exam list, and a merge keeps whatever it
      // leaves out -- so removing the last exam has to delete it by name.
      exams: safe.exams ?? deleteField(),
      schemaVersion: REVISION_PLAN_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
      // Written alongside the client clock so a device with the wrong time
      // cannot silently reorder somebody's plans.
      serverUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  reportTutorialAction("plan-week");
  return { ...safe, id: planId, schemaVersion: REVISION_PLAN_SCHEMA_VERSION, createdAt: now, updatedAt: now };
}

export async function archiveRevisionPlan(uid: string, planId: string) {
  await updateDoc(planPath(uid, planId), {
    status: "archived",
    updatedAt: Date.now(),
    serverUpdatedAt: serverTimestamp(),
  });
}

/**
 * One day's exceptions.
 *
 * Merged rather than replaced, so ticking a slot cannot drop a pin the student
 * set earlier in the day, and a stale tab cannot overwrite the other's work
 * with a whole document it happened to be holding.
 */
export async function saveRevisionPlanEntry(
  uid: string,
  planId: string,
  entry: RevisionPlanEntry
) {
  await setDoc(
    entryPath(uid, planId, entry.dayKey),
    {
      dayKey: entry.dayKey,
      ...(entry.pinned ? { pinned: entry.pinned } : {}),
      ...(entry.skipped === undefined ? {} : { skipped: entry.skipped }),
      ...(entry.completedSlotIds ? { completedSlotIds: entry.completedSlotIds } : {}),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}
