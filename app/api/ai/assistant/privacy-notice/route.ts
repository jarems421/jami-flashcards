import type { NextRequest } from "next/server";
import {
  assistantAssetError,
  authenticateAssistantAssetRequest,
} from "@/services/ai/assistant-assets.server";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";
export const AI_PRIVACY_NOTICE_VERSION = 2;

export async function GET(request: NextRequest) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  const user = await getAdminDb().collection("users").doc(uid).get();
  return Response.json({
    version: AI_PRIVACY_NOTICE_VERSION,
    acknowledged:
      user.exists &&
      user.data()?.aiPrivacyNoticeVersion === AI_PRIVACY_NOTICE_VERSION,
  });
}

export async function POST(request: NextRequest) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  await getAdminDb().collection("users").doc(uid).set(
    {
      aiPrivacyNoticeVersion: AI_PRIVACY_NOTICE_VERSION,
      aiPrivacyNoticeAcknowledgedAt: Date.now(),
    },
    { merge: true }
  );
  return Response.json({
    version: AI_PRIVACY_NOTICE_VERSION,
    acknowledged: true,
  });
}
