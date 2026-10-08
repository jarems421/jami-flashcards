import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import { migrateLegacyPracticePaperSecret } from "@/services/ai/practice-paper-secrets.server";
import {
  deletePracticePaperWithAdmin,
  PracticePaperDeletionError,
} from "@/services/ai/practice-paper-deletion.server";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { paperId } = await params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(paperId)) {
    return apiFailure("Practice paper not found", 404, "paper_not_found");
  }
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("pastPapers")
    .doc(paperId)
    .get();
  if (!snapshot.exists) {
    return apiFailure("Practice paper not found", 404, "paper_not_found");
  }
  const data = snapshot.data() ?? {};
  const paper = await migrateLegacyPracticePaperSecret({ uid, paperId, paperData: data });
  return Response.json(
    paper.markScheme.items.length === 0
      ? paper
      : mapPracticePaperData(paperId, {
          ...data,
          markScheme: { ...paper.markScheme, items: [] },
        })
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { paperId } = await params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(paperId)) {
    return apiFailure("Practice paper not found", 404, "paper_not_found");
  }
  try {
    return Response.json(await deletePracticePaperWithAdmin(uid, paperId));
  } catch (error) {
    if (error instanceof PracticePaperDeletionError) {
      return apiFailure(error.message, error.status, error.code);
    }
    return apiFailure(
      "This practice paper could not be deleted just now.",
      500,
      "paper_delete_failed"
    );
  }
}
