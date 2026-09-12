import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { getAdminDb } from "@/services/firebase/admin";
import { featureFlags } from "@/lib/app/feature-flags";

export const runtime = "nodejs";

const REASONS = new Set(["multiple-correct", "wrong-grade", "poor-gap", "unrelated-options", "other"]);

export async function POST(request: NextRequest) {
  if (!featureFlags.enableStudyModes) return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
  const uid = await authenticateWriteRequest(request);
  if (!uid) return Response.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const cardId = typeof body?.cardId === "string" ? body.cardId.trim().slice(0, 120) : "";
  const variantId = typeof body?.variantId === "string" ? body.variantId.trim().slice(0, 120) : "";
  const reason = typeof body?.reason === "string" && REASONS.has(body.reason) ? body.reason : "other";
  const bundleVersion = typeof body?.bundleVersion === "number" && Number.isInteger(body.bundleVersion) ? body.bundleVersion : 0;
  if (!cardId || !variantId || bundleVersion < 1) return Response.json({ error: "Invalid report", code: "invalid_request" }, { status: 400 });

  const db = getAdminDb();
  const cardRef = db.collection("cards").doc(cardId);
  const assetRef = db.collection("cardStudyAssets").doc(cardId);
  const reportId = createHash("sha256").update(`${uid}\0${cardId}\0${bundleVersion}\0${variantId}`).digest("hex");
  const reportRef = db.collection("studyVariantReports").doc(reportId);
  const saved = await db.runTransaction(async (transaction) => {
    const [card, asset, existing] = await Promise.all([transaction.get(cardRef), transaction.get(assetRef), transaction.get(reportRef)]);
    const assetData = asset.data();
    if (!card.exists || card.data()?.userId !== uid || !asset.exists || assetData?.userId !== uid) return "not-found" as const;
    if (assetData.schemaVersion !== bundleVersion) return "stale" as const;
    const generated = assetData.asset && typeof assetData.asset === "object" ? assetData.asset as Record<string, unknown> : {};
    const variantExists = [generated.mcqVariants, generated.gapVariants].some((variants) =>
      Array.isArray(variants) && variants.some((variant) => variant && typeof variant === "object" && (variant as Record<string, unknown>).id === variantId)
    );
    if (!variantExists) return "stale" as const;
    if (!existing.exists) {
      transaction.create(reportRef, { uid, cardId, variantId, bundleVersion, reason, createdAt: FieldValue.serverTimestamp(), replacementQueued: true });
      transaction.update(assetRef, { retiredVariantIds: FieldValue.arrayUnion(variantId), "asset.retiredVariantIds": FieldValue.arrayUnion(variantId), repairRequested: true, repairAttemptedForPromptVersion: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    return "saved" as const;
  });
  if (saved === "not-found") return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
  if (saved === "stale") return Response.json({ error: "This exercise has changed", code: "stale_exercise" }, { status: 409 });
  return Response.json({ ok: true });
}
