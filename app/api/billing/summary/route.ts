import type { NextRequest } from "next/server";
import { authenticateRequest } from "@/services/auth/authenticate-request.server";
import { buildPlanSummary } from "@/lib/billing/summary";
import { getAllowancePeriod } from "@/lib/billing/plans";
import { createLogger } from "@/lib/observability/logger";
import { allowanceUsageRef, readAllowanceUsage } from "@/services/billing/allowances.server";
import { getEntitlement } from "@/services/billing/entitlements.server";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The student's plan and what is left of each allowance this month, for the
 * Account page. `{ enabled: false }` while billing is switched off, so the page
 * shows nothing about plans until they exist.
 */
export async function GET(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const log = createLogger({ route: "billing.summary", uid });
  try {
    const now = Date.now();
    const entitlement = await getEntitlement(uid, now);
    if (!entitlement || entitlement.plan === "lifetime") {
      return Response.json(
        buildPlanSummary({ entitlement, usage: { used: {}, extra: {} }, period: null }),
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const period = getAllowancePeriod(entitlement.anchor, now);
    const snapshot = await allowanceUsageRef(getAdminDb(), uid, period.key).get();
    return Response.json(
      buildPlanSummary({ entitlement, usage: readAllowanceUsage(snapshot.data()), period }),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    log.error("summary.failed", { error });
    return Response.json({ error: "Your plan could not be loaded just now." }, { status: 503 });
  }
}
