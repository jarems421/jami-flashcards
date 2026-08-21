import type { NextRequest } from "next/server";
import { listExamFormatProfiles } from "@/services/ai/exam-format-library.server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const profiles = await listExamFormatProfiles(300);
  return Response.json({ profiles });
}
