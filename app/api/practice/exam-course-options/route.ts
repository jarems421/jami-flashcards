import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const board = request.nextUrl.searchParams.get("board")?.trim() ?? "";
  const qualification = request.nextUrl.searchParams.get("qualification")?.trim() ?? "";
  const subject = request.nextUrl.searchParams.get("subject")?.trim().toLowerCase() ?? "";
  if (!board || !qualification) return Response.json({ courses: [] });
  const snapshot = await getAdminDb().collection("examFormatCatalogue").where("board", "==", board).limit(300).get();
  const grouped = new Map<string, { specificationId: string; specificationTitle: string; tiers: Set<string>; componentIds: Set<string> }>();
  for (const document of snapshot.docs) {
    const data = document.data();
    if (data.qualification !== qualification || data.status !== "current") continue;
    if (subject && typeof data.subject === "string" && !data.subject.toLowerCase().includes(subject) && !subject.includes(data.subject.toLowerCase())) continue;
    const specificationId = typeof data.specificationCode === "string" ? data.specificationCode.trim() : "";
    if (!specificationId) continue;
    const existing = grouped.get(specificationId) ?? { specificationId, specificationTitle: typeof data.specificationTitle === "string" ? data.specificationTitle : data.subject ?? specificationId, tiers: new Set<string>(), componentIds: new Set<string>() };
    if (typeof data.tier === "string" && data.tier.trim()) existing.tiers.add(data.tier.trim());
    if (typeof data.componentCode === "string" && data.componentCode.trim()) existing.componentIds.add(data.componentCode.trim());
    grouped.set(specificationId, existing);
  }
  return Response.json({ courses: [...grouped.values()].map((course) => ({ ...course, tiers: [...course.tiers].sort(), componentIds: [...course.componentIds].sort() })).sort((a, b) => a.specificationTitle.localeCompare(b.specificationTitle)) });
}
