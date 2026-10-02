import type { NotebookType } from "@/lib/workspace/notebooks";
import { PLAN_LABELS, PLAN_SPACE_LIMITS, type PlanId } from "@/lib/billing/plans";

/**
 * Room on a plan: how many folders a student can keep, and how many notebooks
 * of their own in each (doc §2). Separate from monthly allowances, because
 * nothing here is used up; archiving a folder or notebook makes room again.
 */

export type SpaceKind = "folders" | "notebooks";

/**
 * Notebooks a student makes themselves. Papers and practice notebooks are
 * counted by their own allowances, so they never fill a folder's room.
 */
export const OWN_NOTEBOOK_TYPES: readonly NotebookType[] = [
  "blank",
  "uploaded_file",
  "free_working",
  "general_working",
  "source_notes",
];

export function getSpaceLimit(plan: PlanId, kind: SpaceKind): number | null {
  const limits = PLAN_SPACE_LIMITS[plan];
  return kind === "folders" ? limits.folders : limits.notebooksPerFolder;
}

/** How many more can be made, or null for no limit. Never negative. */
export function getSpaceLeft(plan: PlanId, kind: SpaceKind, count: number): number | null {
  const limit = getSpaceLimit(plan, kind);
  return limit === null ? null : Math.max(0, limit - count);
}

/** What a student sees when there is no room: what the plan includes, and two ways on. */
export function describeSpaceLimit(plan: PlanId, kind: SpaceKind) {
  const limit = getSpaceLimit(plan, kind) ?? 0;
  const what = kind === "folders" ? `${limit} folders` : `${limit} notebooks in each folder`;
  const one = kind === "folders" ? "a folder" : "a notebook";
  return `${PLAN_LABELS[plan]} includes ${what}. Archive ${one} to make room, or choose ${PLAN_LABELS.plus} for as many as you like.`;
}
