import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import {
  applyPracticePaperMarkCorrection,
  mapPracticePaperData,
  type PracticePaperAttempt,
} from "@/lib/practice/practice-papers";
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

function publicPaper(paperId: string, data: Record<string, unknown>) {
  return mapPracticePaperData(paperId, data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");
  const { paperId } = await params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(paperId)) {
    return failure("Practice paper not found", 404, "paper_not_found");
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const paperRef = userRef.collection("pastPapers").doc(paperId);
  const paperSnapshot = await paperRef.get();
  if (!paperSnapshot.exists) return failure("Practice paper not found", 404, "paper_not_found");
  const paperData = paperSnapshot.data() ?? {};
  const paper = publicPaper(paperId, paperData);
  const now = Date.now();

  if (action === "start") {
    if (paper.status !== "ready" && paper.status !== "marked") {
      return failure("This paper cannot be started now.", 409, "invalid_state");
    }
    const clearPreviousWork = body.clearPreviousWork === true;
    const pages = clearPreviousWork
      ? await userRef.collection("notebookPages").where("notebookId", "==", paperId).limit(100).get()
      : null;
    if (pages && pages.size >= 100) {
      return failure("This paper has too many pages to reset safely.", 413, "paper_too_large");
    }
    const attemptNumber = paper.attemptCount + 1;
    const attemptRef = userRef.collection("practicePaperAttempts").doc();
    const deadlineAt = paper.timingMode === "timed" && paper.durationMinutes > 0
      ? now + paper.durationMinutes * 60_000
      : null;
    const attempt: Omit<PracticePaperAttempt, "id"> = {
      paperId,
      notebookId: paper.notebookId,
      paperTitle: paper.title,
      attemptNumber,
      status: "in_progress",
      startedAt: now,
      timingMode: paper.timingMode,
      timingState: "running",
      durationMinutes: paper.durationMinutes,
      deadlineAt: deadlineAt ?? undefined,
      totalPausedMs: 0,
      deadlineVersion: 1,
      tutorEnabled: paper.tutorEnabled,
      tutorUsed: false,
      assisted: paper.tutorEnabled,
      createdAt: now,
      updatedAt: now,
    };
    const batch = db.batch();
    pages?.docs.forEach((page) => {
      batch.update(page.ref, {
        typedContent: null,
        textBlocks: [],
        inkData: null,
        strokeData: null,
        thumbnail: null,
        status: "blank",
        contentRevision: FieldValue.increment(1),
        updatedAt: now,
      });
      batch.delete(userRef.collection("notebookPageInk").doc(page.id));
    });
    if (pages) {
      batch.update(userRef.collection("notebooks").doc(paper.notebookId), {
        previewInkSvg: null,
        previewPageId: null,
        updatedAt: now,
      });
    }
    batch.set(attemptRef, attempt);
    const updates = {
      status: "in_progress",
      activeAttemptId: attemptRef.id,
      attemptCount: attemptNumber,
      startedAt: now,
      timingState: "running",
      deadlineAt,
      pausedAt: null,
      totalPausedMs: 0,
      overtimeStartedAt: null,
      deadlineSnapshotAt: null,
      deadlineVersion: 1,
      tutorUsed: false,
      submittedAt: null,
      markedAt: null,
      result: null,
      updatedAt: now,
    };
    batch.update(paperRef, updates);
    await batch.commit();
    return Response.json(publicPaper(paperId, { ...paperData, ...updates }));
  }

  if (action === "submit") {
    if (paper.status !== "in_progress" || !paper.activeAttemptId) {
      return failure("This paper is not being sat.", 409, "invalid_state");
    }
    const updates = {
      status: "submitted",
      timingState: "submitted",
      submittedAt: now,
      updatedAt: now,
    };
    const batch = db.batch();
    batch.update(paperRef, updates);
    batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), updates);
    await batch.commit();
    return Response.json(publicPaper(paperId, { ...paperData, ...updates }));
  }

  if (action === "pause") {
    if (paper.status !== "in_progress" || paper.timingState !== "running" || !paper.activeAttemptId) {
      return failure("This attempt cannot be paused now.", 409, "invalid_state");
    }
    const updates = {
      timingState: "paused",
      pausedAt: now,
      deadlineVersion: FieldValue.increment(1),
      updatedAt: now,
    };
    const batch = db.batch();
    batch.update(paperRef, updates);
    batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), updates);
    await batch.commit();
    return Response.json(publicPaper(paperId, {
      ...paperData,
      timingState: "paused",
      pausedAt: now,
      deadlineVersion: paper.deadlineVersion + 1,
      updatedAt: now,
    }));
  }

  if (action === "resume") {
    if (paper.status !== "in_progress" || paper.timingState !== "paused" || !paper.pausedAt || !paper.activeAttemptId) {
      return failure("This attempt is not paused.", 409, "invalid_state");
    }
    const pausedFor = Math.max(0, now - paper.pausedAt);
    const deadlineAt = paper.deadlineAt ? paper.deadlineAt + pausedFor : null;
    const updates = {
      timingState: "running",
      pausedAt: null,
      deadlineAt,
      totalPausedMs: paper.totalPausedMs + pausedFor,
      deadlineVersion: FieldValue.increment(1),
      updatedAt: now,
    };
    const batch = db.batch();
    batch.update(paperRef, updates);
    batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), updates);
    await batch.commit();
    return Response.json(publicPaper(paperId, {
      ...paperData,
      ...updates,
      deadlineVersion: paper.deadlineVersion + 1,
    }));
  }

  if (action === "continue_overtime") {
    if (paper.status !== "in_progress" || paper.timingState !== "awaiting_overtime" || !paper.activeAttemptId) {
      return failure("This attempt is not awaiting overtime.", 409, "invalid_state");
    }
    const updates = {
      timingState: "overtime",
      overtimeStartedAt: now,
      deadlineVersion: FieldValue.increment(1),
      updatedAt: now,
    };
    const batch = db.batch();
    batch.update(paperRef, updates);
    batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), updates);
    await batch.commit();
    return Response.json(publicPaper(paperId, {
      ...paperData,
      timingState: "overtime",
      overtimeStartedAt: now,
      deadlineVersion: paper.deadlineVersion + 1,
      updatedAt: now,
    }));
  }

  if (action === "capture_deadline") {
    if (
      paper.status !== "in_progress" ||
      paper.timingMode !== "timed" ||
      paper.timingState !== "running" ||
      !paper.deadlineAt ||
      paper.deadlineAt > now ||
      !paper.activeAttemptId
    ) return Response.json(paper);
    const pages = await userRef.collection("notebookPages").where("notebookId", "==", paperId).limit(41).get();
    if (pages.size > 40) return failure("This paper has too many pages to snapshot safely.", 413, "paper_too_large");
    const inks = await Promise.all(
      pages.docs.map((page) => userRef.collection("notebookPageInk").doc(page.id).get())
    );
    const deadlineVersion = paper.deadlineVersion + 1;
    const updates = {
      timingState: "awaiting_overtime",
      deadlineSnapshotAt: now,
      deadlineVersion,
      updatedAt: now,
    };
    const batch = db.batch();
    batch.update(paperRef, updates);
    batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), updates);
    pages.docs.forEach((page, index) => {
      batch.set(userRef.collection("practicePaperDeadlineSnapshots").doc(`${paper.activeAttemptId}_${page.id}`), {
        attemptId: paper.activeAttemptId,
        paperId,
        notebookId: paper.notebookId,
        pageId: page.id,
        deadlineVersion,
        capturedAt: now,
        page: page.data(),
        ink: inks[index].exists ? inks[index].data() : null,
      });
    });
    await batch.commit();
    return Response.json(publicPaper(paperId, { ...paperData, ...updates }));
  }

  if (action === "record_tutor_use") {
    if (!paper.activeAttemptId || !paper.tutorEnabled || paper.tutorUsed) return Response.json(paper);
    const batch = db.batch();
    batch.update(paperRef, { tutorUsed: true, updatedAt: now });
    batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), {
      tutorUsed: true,
      assisted: true,
      updatedAt: now,
    });
    await batch.commit();
    return Response.json(publicPaper(paperId, { ...paperData, tutorUsed: true, updatedAt: now }));
  }

  if (action === "correct_mark") {
    if (paper.status !== "marked" || !paper.result) {
      return failure("This paper has not been marked yet.", 409, "invalid_state");
    }
    const questionId = typeof body.questionId === "string" ? body.questionId.slice(0, 80) : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const awardedMarks = typeof body.awardedMarks === "number" ? body.awardedMarks : Number.NaN;
    if (!questionId || !Number.isFinite(awardedMarks) || reason.length < 2) {
      return failure("Add a valid correction and reason.", 400, "invalid_request");
    }
    const result = applyPracticePaperMarkCorrection(
      paper.result,
      questionId,
      awardedMarks,
      reason,
      paper.gradeGuidance
    );
    const batch = db.batch();
    batch.update(paperRef, { result, updatedAt: now });
    if (paper.activeAttemptId) {
      batch.update(userRef.collection("practicePaperAttempts").doc(paper.activeAttemptId), {
        result,
        updatedAt: now,
      });
    }
    await batch.commit();
    return Response.json(publicPaper(paperId, { ...paperData, result, updatedAt: now }));
  }

  return failure("Unsupported paper action", 400, "invalid_action");
}
