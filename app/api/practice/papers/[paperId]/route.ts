import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import { migrateLegacyPracticePaperSecret } from "@/services/ai/practice-paper-secrets.server";
import {
  deletePracticePaperWithAdmin,
  PracticePaperDeletionError,
} from "@/services/ai/practice-paper-deletion.server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

function failure(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

async function authenticate(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { paperId } = await params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(paperId)) {
    return failure("Practice paper not found", 404, "paper_not_found");
  }
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("pastPapers")
    .doc(paperId)
    .get();
  if (!snapshot.exists) {
    return failure("Practice paper not found", 404, "paper_not_found");
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
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { paperId } = await params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(paperId)) {
    return failure("Practice paper not found", 404, "paper_not_found");
  }
  try {
    return Response.json(await deletePracticePaperWithAdmin(uid, paperId));
  } catch (error) {
    if (error instanceof PracticePaperDeletionError) {
      return failure(error.message, error.status, error.code);
    }
    return failure(
      "This practice paper could not be deleted just now.",
      500,
      "paper_delete_failed"
    );
  }
}
