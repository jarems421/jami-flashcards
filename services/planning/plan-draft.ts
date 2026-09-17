import { auth } from "@/services/firebase/client";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import type { RevisionPlanDraft } from "@/lib/planning/types";

/** One side of the planning conversation, as the panel holds it. */
export type PlanDraftTurn = { role: "student" | "jami"; text: string };

export type PlanDraftAnswer = {
  reply: string;
  /** A plan to open in the builder, or null while Jami is still asking. */
  plan: RevisionPlanDraft | null;
  notices: PlanNotice[];
};

/**
 * Ask Jami to suggest a shape for the week.
 *
 * The plan that comes back is normalised again on arrival. It was normalised on
 * the server too, and doing it twice is deliberate: this is the value that gets
 * put straight into the builder's state, so it has to be a plan by the time it
 * is a React prop, whatever happened in between.
 */
export async function draftPlanWithJami(input: {
  message: string;
  history: readonly PlanDraftTurn[];
}): Promise<PlanDraftAnswer> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to plan with Jami.");

  const response = await fetch("/api/ai/plan-draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ message: input.message, history: input.history }),
  });
  if (!response.ok) throw new Error("Jami could not suggest a plan just now.");

  const body: unknown = await response.json();
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const rawPlan = record.plan;
  const normalized =
    rawPlan && typeof rawPlan === "object"
      ? normalizeRevisionPlanDraft(rawPlan as Partial<RevisionPlanDraft>)
      : null;

  return {
    reply: typeof record.reply === "string" ? record.reply : "",
    // A plan that does not stand on its own is not offered: half a plan in the
    // builder is worse than the builder's own empty state.
    plan: normalized?.valid ? normalized.draft : null,
    notices: Array.isArray(record.notices) ? (record.notices as PlanNotice[]) : [],
  };
}

/** What Jami has noticed, for the panel to show before anyone has typed. */
export async function loadPlanNotices(): Promise<PlanNotice[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const response = await fetch("/api/learning/study-actions", {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const { buildPlanNotices } = await import("@/lib/ai/assistant-plan");
    const folders = Array.isArray(record.folders)
      ? (record.folders as { id: string; name: string }[])
      : [];
    return buildPlanNotices(
      Array.isArray(record.actions) ? (record.actions as never[]) : [],
      new Map(folders.map((folder) => [`folder:${folder.id}`, folder.name]))
    );
  } catch {
    // The panel works without them; it just cannot open with what it noticed.
    return [];
  }
}
