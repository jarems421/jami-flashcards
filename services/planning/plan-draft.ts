import { auth } from "@/services/firebase/client";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import type { RevisionPlanDraft } from "@/lib/planning/types";

/** One side of the planning conversation, as the panel holds it. */
export type PlanDraftTurn = { role: "student" | "jami"; text: string };

/**
 * Why a planning message failed, in the words the student should read.
 *
 * The route has always distinguished its failures and the client has always
 * thrown the distinction away, so "Jami couldn't answer just now" was the reply
 * to a missing sign-in, an unconfigured provider, a timeout and a genuine
 * outage alike -- and a student pressing send again on a provider that is not
 * there was the commonest version of that. The code comes from the server; the
 * sentence is chosen here, next to the panel that shows it.
 */
export type PlanDraftErrorCode =
  | "signed_out"
  | "ai_unconfigured"
  | "plan_draft_timeout"
  | "plan_draft_unavailable";

const PLAN_DRAFT_MESSAGES: Record<PlanDraftErrorCode, string> = {
  signed_out: "Sign in again to plan with Jami.",
  ai_unconfigured:
    "Jami's planning help isn't switched on here. You can still build a plan yourself.",
  plan_draft_timeout: "Jami took too long to answer. Try again, or build the plan yourself.",
  plan_draft_unavailable:
    "Jami couldn't answer just now. You can still build a plan yourself.",
};

export class PlanDraftError extends Error {
  readonly code: PlanDraftErrorCode;
  /** Whether pressing send again could plausibly work. */
  readonly retryable: boolean;

  constructor(code: PlanDraftErrorCode) {
    super(PLAN_DRAFT_MESSAGES[code]);
    this.name = "PlanDraftError";
    this.code = code;
    this.retryable = code === "plan_draft_timeout" || code === "plan_draft_unavailable";
  }
}

function readErrorCode(status: number, body: unknown): PlanDraftErrorCode {
  const code =
    body && typeof body === "object" ? (body as Record<string, unknown>).code : undefined;
  if (code === "ai_unconfigured" || code === "plan_draft_timeout") return code;
  if (status === 401) return "signed_out";
  if (status === 504) return "plan_draft_timeout";
  return "plan_draft_unavailable";
}

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
  /** The draft on screen, so Jami adjusts it rather than starting again. */
  draft?: RevisionPlanDraft | null;
}): Promise<PlanDraftAnswer> {
  const user = auth.currentUser;
  if (!user) throw new PlanDraftError("signed_out");

  const response = await fetch("/api/ai/plan-draft", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({
      message: input.message,
      history: input.history,
      ...(input.draft ? { draft: input.draft } : {}),
    }),
  });
  if (!response.ok) {
    // Read rather than discarded: the route says which failure this was, and
    // the panel can only tell the student if the reason survives the fetch.
    const failure: unknown = await response.json().catch(() => null);
    throw new PlanDraftError(readErrorCode(response.status, failure));
  }

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
