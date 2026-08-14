import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  buildPracticePaperPayload,
  mapPracticePaperData,
  type PracticePaper,
  type PracticePaperTimingMode,
  mapPracticePaperAttemptData,
  type PracticePaperAttempt,
} from "@/lib/practice/practice-papers";
import type { Notebook } from "@/lib/workspace/notebooks";
import {
  updateNotebook,
} from "@/services/study/notebooks";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function practicePaperRef(userId: string, notebookId: string) {
  return doc(db, "users", userId, "pastPapers", notebookId);
}

export async function getPracticePaperByNotebookId(
  userId: string,
  notebookId: string
): Promise<PracticePaper | null> {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedNotebookId) throw new Error("Missing notebookId.");
  const user = auth.currentUser;
  if (!user || user.uid !== normalizedUserId) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await withTimeout(
    fetch(`/api/practice/papers/${encodeURIComponent(normalizedNotebookId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    LOAD_MS,
    "Load practice paper"
  );
  if (response.status === 404) return null;
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not load this practice paper."
    );
  }
  return mapPracticePaperData(normalizedNotebookId, data);
}

export async function deletePracticePaper(
  userId: string,
  paperId: string
) {
  const normalizedUserId = userId.trim();
  const normalizedPaperId = paperId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedPaperId) throw new Error("Missing paperId.");
  const user = auth.currentUser;
  if (!user || user.uid !== normalizedUserId) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await withTimeout(
    fetch(`/api/practice/papers/${encodeURIComponent(normalizedPaperId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }),
    WRITE_MS,
    "Delete practice paper"
  );
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || data?.deleted !== true) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not delete this practice paper."
    );
  }
  invalidateDashboardData(normalizedUserId);
  return data;
}

async function runPracticePaperAction(
  userId: string,
  paperId: string,
  body: Record<string, unknown>
) {
  const user = auth.currentUser;
  if (!user || user.uid !== userId.trim()) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const response = await withTimeout(
    fetch(`/api/practice/papers/${encodeURIComponent(paperId)}/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
    WRITE_MS,
    "Update practice paper"
  );
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not update this practice paper."
    );
  }
  invalidateDashboardData(userId);
  return mapPracticePaperData(paperId, data);
}

export async function createUploadedPracticePaper(input: {
  userId: string;
  notebook: Notebook;
  sourceIds: string[];
  sourceLabels: string[];
  markSchemeSourceId?: string;
  durationMinutes?: number;
  timingMode: PracticePaperTimingMode;
  tutorEnabled: boolean;
}) {
  const now = Date.now();
  const payload = buildPracticePaperPayload({
    notebookId: input.notebook.id,
    folderId: input.notebook.folderId,
    title: input.notebook.title,
    origin: "uploaded",
    status: "ready",
    sourceIds: input.sourceIds,
    sourceLabels: input.sourceLabels,
    request: "Uploaded practice paper",
    coverage: "As provided in the uploaded paper",
    length: "full",
    focus: "balanced",
    durationMinutes: Math.max(0, input.durationMinutes ?? 0),
    timingMode: input.timingMode,
    timingState: "not_started",
    deadlineAt: undefined,
    pausedAt: undefined,
    totalPausedMs: 0,
    overtimeStartedAt: undefined,
    deadlineSnapshotAt: undefined,
    deadlineVersion: 0,
    tutorEnabled: input.tutorEnabled,
    tutorUsed: false,
    timerEnabled: input.timingMode === "timed",
    instructions: [],
    assessmentProfile: {
      studyLevel: "To be inferred from the uploaded paper",
      qualificationOrModule: "To be inferred",
      awardingBodyOrInstitution: "",
      specificationOrCourse: "",
      tierOrComponent: "",
      formatSummary: "Uploaded paper",
      confidence: "low",
    },
    questions: [],
    choiceGroups: [],
    totalMarks: 0,
    markScheme: {
      kind: input.markSchemeSourceId ? "official" : "estimated",
      label: input.markSchemeSourceId
        ? "Uploaded marking guide"
        : "Jami-estimated marking guide",
      notice: input.markSchemeSourceId
        ? "The uploaded marking guide will be used when this paper is marked."
        : "No official mark scheme was provided. Jami will prepare an estimated guide before the attempt.",
      items: [],
    },
    markSchemeSourceId: input.markSchemeSourceId,
    preparedAt: input.markSchemeSourceId ? now : undefined,
    gradeGuidance: {
      kind: "none",
      label: "No grade guidance",
      notice: "Grade guidance will be inferred only when the paper provides enough evidence.",
      boundaries: [],
    },
    examinerInsights: [],
    attemptCount: 0,
  });
  await Promise.all([
    withTimeout(
      setDoc(practicePaperRef(input.userId, input.notebook.id), payload),
      WRITE_MS,
      "Save uploaded practice paper"
    ),
    updateNotebook(input.userId, input.notebook.id, {
      type: "practice_paper",
      sourceIds: input.sourceIds,
      pastPaperId: input.notebook.id,
    }),
  ]);
  invalidateDashboardData(input.userId);
  return mapPracticePaperData(input.notebook.id, payload);
}

export async function getPracticePaperAttempts(
  userId: string,
  paperId: string
): Promise<PracticePaperAttempt[]> {
  const snapshot = await withTimeout(
    getDocs(query(
      collection(db, "users", userId, "practicePaperAttempts"),
      where("paperId", "==", paperId)
    )),
    LOAD_MS,
    "Load paper attempts"
  );
  return snapshot.docs
    .map((item) => mapPracticePaperAttemptData(item.id, item.data()))
    .sort((left, right) => right.attemptNumber - left.attemptNumber);
}

export async function getRecentPracticePaperAttempts(
  userId: string,
  maximum = 20
): Promise<PracticePaperAttempt[]> {
  const snapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "practicePaperAttempts")),
    LOAD_MS,
    "Load recent paper attempts"
  );
  return snapshot.docs
    .map((item) => mapPracticePaperAttemptData(item.id, item.data()))
    .filter((attempt) => attempt.status === "marked" && attempt.result)
    .sort((left, right) => (right.markedAt ?? 0) - (left.markedAt ?? 0))
    .slice(0, Math.max(1, Math.min(50, maximum)));
}

export async function startPracticePaperAttempt(
  userId: string,
  paper: PracticePaper,
  options: { clearPreviousWork?: boolean } = {}
) {
  return runPracticePaperAction(userId, paper.notebookId, {
    action: "start",
    clearPreviousWork: options.clearPreviousWork === true,
  });
}

export async function submitPracticePaperAttempt(
  userId: string,
  paper: PracticePaper
) {
  const updated = await runPracticePaperAction(userId, paper.notebookId, {
    action: "submit",
  });
  return updated.submittedAt ?? Date.now();
}

export async function pausePracticePaperAttempt(
  userId: string,
  paper: PracticePaper
) {
  return runPracticePaperAction(userId, paper.notebookId, { action: "pause" });
}

export async function resumePracticePaperAttempt(
  userId: string,
  paper: PracticePaper
) {
  return runPracticePaperAction(userId, paper.notebookId, { action: "resume" });
}

export async function capturePracticePaperDeadlineSnapshot(
  userId: string,
  paper: PracticePaper
) {
  return runPracticePaperAction(userId, paper.notebookId, {
    action: "capture_deadline",
  });
}

export async function continuePracticePaperInOvertime(
  userId: string,
  paper: PracticePaper
) {
  return runPracticePaperAction(userId, paper.notebookId, {
    action: "continue_overtime",
  });
}

export async function recordPracticePaperTutorUse(
  userId: string,
  notebookId: string
) {
  await runPracticePaperAction(userId, notebookId, { action: "record_tutor_use" });
}

export async function correctPracticePaperMark(input: {
  userId: string;
  paper: PracticePaper;
  questionId: string;
  awardedMarks: number;
  reason: string;
}) {
  return runPracticePaperAction(input.userId, input.paper.notebookId, {
    action: "correct_mark",
    questionId: input.questionId,
    awardedMarks: input.awardedMarks,
    reason: input.reason,
  });
}
