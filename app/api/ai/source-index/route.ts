import { after } from "next/server";
import type { NextRequest } from "next/server";
import { authenticateRequest } from "@/services/auth/authenticate-request.server";
import { createLogger } from "@/lib/observability/logger";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  refundAiBudget,
} from "@/services/ai/budgets";
import { recordAllowanceUsage } from "@/services/billing/allowances.server";
import {
  deleteSourceIndex,
  rebuildSourceIndex,
} from "@/services/ai/source-index.server";

export const runtime = "nodejs";
/** A whole lecture pack: hundreds of pages to read, cut and embed. */
export const maxDuration = 300;

async function sourceIdFrom(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return typeof body.sourceId === "string"
      ? body.sourceId.trim().slice(0, 160)
      : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sourceId = await sourceIdFrom(request);
  if (!sourceId) return Response.json({ error: "Source is required" }, { status: 400 });
  const log = createLogger({ route: "ai.source-index", uid, sourceId });
  // Charged before any work, like every other AI route. A refusal is quiet on
  // purpose: indexing is never something a student pressed, and without an
  // index the Tutor still reads the source whole.
  // Pages are counted once the source has been read; here it only has to have
  // some of the month's pages left.
  const budget = await checkAiBudget({
    uid,
    action: "sourceIndexing",
    allowance: { key: "pages", amount: 0 },
  }).catch(
    (error: unknown) => {
      log.error("budget.check_failed", { error });
      return null;
    }
  );
  if (!budget) {
    return Response.json({ error: "Indexing is unavailable right now." }, { status: 503 });
  }
  if (!budget.allowed) return createAiBudgetLimitResponse("sourceIndexing", budget);
  const grant = budget.grant;
  after(async () => {
    try {
      const result = await rebuildSourceIndex(uid, sourceId);
      log.info("source.indexed", result);
      const newPages = "newPages" in result ? (result.newPages ?? 0) : 0;
      if (newPages > 0) {
        await recordAllowanceUsage({ uid, key: "pages", amount: newPages }).catch(
          (error: unknown) => log.warn("allowance.record_failed", { error })
        );
      }
    } catch (error) {
      log.error("source.index_failed", { error });
      await refundAiBudget(grant).catch(() => undefined);
    }
  });
  return Response.json({ status: "queued" }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sourceId = await sourceIdFrom(request);
  if (!sourceId) return Response.json({ error: "Source is required" }, { status: 400 });
  const deleted = await deleteSourceIndex(uid, sourceId);
  return Response.json({ status: "deleted", deleted });
}
