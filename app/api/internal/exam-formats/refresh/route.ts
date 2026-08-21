import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  PAPER_GENERATION_BENCHMARK_DEFINITIONS,
} from "@/lib/practice/paper-generation-benchmark";
import {
  refreshExamFormatCatalogueSlice,
  researchExamFormatProfile,
} from "@/services/ai/exam-format-library.server";
import { getCronAuthorizationStatus } from "@/services/auth/cron-authorization";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const SLICES = (["aqa", "pearson_edexcel", "ocr", "eduqas", "wjec", "ccea"] as const)
  .flatMap((board) => (["gcse", "a_level"] as const).map((qualification) => ({ board, qualification })));

export async function GET(request: NextRequest) {
  const status = getCronAuthorizationStatus({
    authorizationHeader: request.headers.get("authorization"),
    configuredSecret: process.env.CRON_SECRET,
  });
  if (status === "misconfigured") return Response.json({ error: "cron_not_configured" }, { status: 503 });
  if (status === "unauthorized") return Response.json({ error: "unauthorized" }, { status: 401 });
  const ref = getAdminDb().collection("examFormatCatalogueControl").doc("refresh-cursor");
  const snapshot = await ref.get();
  const cursor = typeof snapshot.data()?.cursor === "number" ? snapshot.data()!.cursor as number : 0;
  const selected = [SLICES[cursor % SLICES.length], SLICES[(cursor + 1) % SLICES.length]];
  const results = [];
  for (const slice of selected) results.push(await refreshExamFormatCatalogueSlice(slice));
  await ref.set({ cursor: (cursor + 2) % SLICES.length, lastRunAt: Date.now(), runs: FieldValue.increment(1) }, { merge: true });
  return Response.json({ ok: true, selected, results });
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  if (typeof body.profileId === "string") {
    const definition = PAPER_GENERATION_BENCHMARK_DEFINITIONS.find((item) => item.profileId === body.profileId);
    if (!definition) return Response.json({ error: "unknown_profile" }, { status: 404 });
    const profile = await researchExamFormatProfile(definition, { force: true, allowDisabled: true });
    return Response.json({ profile });
  }
  if (
    (body.board === "aqa" || body.board === "pearson_edexcel" || body.board === "ocr" || body.board === "eduqas" || body.board === "wjec" || body.board === "ccea") &&
    (body.qualification === "gcse" || body.qualification === "a_level")
  ) {
    return Response.json(await refreshExamFormatCatalogueSlice({
      board: body.board,
      qualification: body.qualification,
      allowDisabled: true,
    }));
  }
  return Response.json({ error: "profile_or_slice_required" }, { status: 400 });
}
