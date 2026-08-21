import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import { isOfficialExamBoardUrl, type ExamBoardId } from "@/lib/practice/exam-formats";
import { importExamFormatSource } from "@/services/ai/exam-format-library.server";
import { authenticatePaperQualityReviewer } from "@/services/auth/paper-quality-reviewer.server";
import { getAdminStorageBucket } from "@/services/firebase/admin";
import { runExamFormatImportWorkflow } from "@/workflows/exam-format-import";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_FILE_TYPES = new Set(["application/pdf", "text/csv", "application/json", "text/plain"]);
const BOARDS: ExamBoardId[] = ["aqa", "pearson_edexcel", "ocr", "eduqas", "wjec", "ccea"];

function officialUrl(value: string) {
  return BOARDS.some((board) => isOfficialExamBoardUrl(board, value));
}

export async function POST(request: NextRequest) {
  const auth = await authenticatePaperQualityReviewer(request);
  if (!auth.ok) return Response.json({ error: auth.code }, { status: auth.status });
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 20 * 1024 * 1024 || !ALLOWED_FILE_TYPES.has(file.type)) {
      return Response.json({ error: "invalid_file" }, { status: 400 });
    }
    const assetId = randomUUID();
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "-").slice(-180) || "source";
    const storagePath = `internal/examFormatImports/${assetId}/${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await getAdminStorageBucket().file(storagePath).save(bytes, {
      contentType: file.type,
      resumable: false,
      metadata: { cacheControl: "private,no-store", metadata: { reviewerUid: auth.uid } },
    });
    try {
      const imported = await importExamFormatSource({
        createdBy: auth.uid,
        sourceType: "file",
        title: file.name,
        storagePath,
        contentType: file.type,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
      });
      const workflow = await start(runExamFormatImportWorkflow, [imported.id]);
      return Response.json({ ...imported, workflowRunId: workflow.runId }, { status: 202 });
    } catch (error) {
      await getAdminStorageBucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
      throw error;
    }
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  if (typeof body.url === "string" && officialUrl(body.url)) {
    const imported = await importExamFormatSource({
      createdBy: auth.uid,
      sourceType: "url",
      title: typeof body.title === "string" ? body.title.slice(0, 240) : "Official exam source",
      officialUrl: body.url,
    });
    const workflow = await start(runExamFormatImportWorkflow, [imported.id]);
    return Response.json({ ...imported, workflowRunId: workflow.runId }, { status: 202 });
  }
  if (Array.isArray(body.entries) && body.entries.length <= 500) {
    const imported = await importExamFormatSource({
      createdBy: auth.uid,
      sourceType: "manifest",
      title: typeof body.title === "string" ? body.title.slice(0, 240) : "Exam-format manifest",
      manifest: { entries: body.entries },
    });
    const workflow = await start(runExamFormatImportWorkflow, [imported.id]);
    return Response.json({ ...imported, workflowRunId: workflow.runId }, { status: 202 });
  }
  return Response.json({ error: "official_url_file_or_manifest_required" }, { status: 400 });
}
