import { featureFlags } from "@/lib/app/feature-flags";
import type { PlanId } from "@/lib/billing/plans";
import { OWN_NOTEBOOK_TYPES, describeSpaceLimit, getSpaceLeft, type SpaceKind } from "@/lib/billing/space";
import { reportAllowanceRefusal } from "@/services/billing/allowance-events";
import { loadPlanSummary } from "@/services/billing/plan-summary-store";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getNotebooksForFolderPage } from "@/services/study/notebooks";

/**
 * Keeps Free to its room: three folders, three of the student's own notebooks
 * in each (lib/billing/space.ts).
 *
 * Checked in the browser before anything is made. Folders and notebooks cost
 * nothing to run, so this is a plan boundary rather than a cost safeguard, and
 * like the rest of the plan it fails open: billing off, no plan summary, or a
 * slow count all let the student carry on.
 */

export class SpaceLimitError extends Error {
  constructor(readonly kind: SpaceKind, message: string) {
    super(message);
    this.name = "SpaceLimitError";
  }
}

async function currentPlan(): Promise<PlanId | null> {
  if (!featureFlags.enableBilling) return null;
  try {
    const summary = await loadPlanSummary();
    return summary.enabled ? summary.plan : null;
  } catch {
    return null;
  }
}

type Room = { plan: PlanId; left: number } | null;

/** How many more folders this student can make, or null for no limit (or no plan to read). */
export async function getFolderRoom(userId: string): Promise<Room> {
  const plan = await currentPlan();
  if (!plan || getSpaceLeft(plan, "folders", 0) === null) return null;
  try {
    const folders = await getActiveStudyFolders(userId, { force: true });
    return { plan, left: getSpaceLeft(plan, "folders", folders.length) ?? Infinity };
  } catch {
    return null;
  }
}

/** How many more of the student's own notebooks fit in this folder, or null for no limit. */
export async function getNotebookRoom(userId: string, folderId: string): Promise<Room> {
  const plan = await currentPlan();
  if (!plan || getSpaceLeft(plan, "notebooks", 0) === null) return null;
  try {
    const { items } = await getNotebooksForFolderPage(userId, folderId, { pageSize: 100 });
    const own = items.filter((notebook) => OWN_NOTEBOOK_TYPES.includes(notebook.type)).length;
    return { plan, left: getSpaceLeft(plan, "notebooks", own) ?? Infinity };
  } catch {
    return null;
  }
}

function refuse(kind: SpaceKind, plan: PlanId): never {
  const message = describeSpaceLimit(plan, kind);
  // The same sheet that offers plans when an allowance runs out.
  reportAllowanceRefusal({ code: "allowance_used", allowance: null, error: message });
  throw new SpaceLimitError(kind, message);
}

export async function assertRoomForFolder(userId: string) {
  const room = await getFolderRoom(userId);
  if (room && room.left <= 0) refuse("folders", room.plan);
}

export async function assertRoomForNotebook(userId: string, folderId: string) {
  const room = await getNotebookRoom(userId, folderId);
  if (room && room.left <= 0) refuse("notebooks", room.plan);
}
