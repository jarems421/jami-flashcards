import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  buildPracticePaperPayload,
  mapPracticePaperData,
  type GeneratedPracticePaper,
  type PracticePaper,
  type PracticePaperFocus,
  type PracticePaperLength,
  type PracticePaperResult,
  type PracticePaperStatus,
  mapPracticePaperAttemptData,
  type PracticePaperAttempt,
  applyPracticePaperMarkCorrection,
} from "@/lib/practice/practice-papers";
import type { Notebook } from "@/lib/workspace/notebooks";
import {
  createNotebook,
  createNotebookPages,
  updateNotebook,
} from "@/services/study/notebooks";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function formatQuestionPrompt(question: PracticePaper["questions"][number]) {
  return [
    question.prompt,
    "",
    `[${question.marks} ${question.marks === 1 ? "mark" : "marks"}]`,
  ].join("\n");
}

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
  const snapshot = await withTimeout(
    getDoc(practicePaperRef(normalizedUserId, normalizedNotebookId)),
    LOAD_MS,
    "Load practice paper"
  );
  return snapshot.exists()
    ? mapPracticePaperData(
        snapshot.id,
        snapshot.data() as Record<string, unknown>
      )
    : null;
}

export async function createGeneratedPracticePaperWorkspace(input: {
  userId: string;
  folderId: string;
  request: string;
  coverage: string;
  length: PracticePaperLength;
  focus: PracticePaperFocus;
  focusDetail?: string;
  timerEnabled: boolean;
  generated: GeneratedPracticePaper;
}) {
  const notebook = await createNotebook(input.userId, {
    folderId: input.folderId,
    title: input.generated.title,
    type: "practice_paper",
    sourceIds: input.generated.sourceIds,
    color: "violet",
    icon: "notebook",
    pageColor: "white",
    pageStyle: "plain",
  });
  try {
    const pages = await createNotebookPages(
      input.userId,
      input.generated.questions.map((question, index) => ({
        notebookId: notebook.id,
        folderId: input.folderId,
        pageNumber: index + 1,
        title: question.label,
        pageType: "question" as const,
        pageColor: "white" as const,
        pageStyle: "plain" as const,
        status: "blank" as const,
        questionPrompt: formatQuestionPrompt(question),
        questionAssets: question.assets,
        linkedQuestionId: question.id,
        linkedPastPaperId: notebook.id,
      }))
    );
    const payload = buildPracticePaperPayload({
      notebookId: notebook.id,
      folderId: input.folderId,
      title: input.generated.title,
      origin: "generated",
      status: "ready",
      sourceIds: input.generated.sourceIds,
      sourceLabels: input.generated.sourceLabels,
      request: input.request,
      coverage: input.coverage,
      length: input.length,
      focus: input.focus,
      focusDetail: input.focusDetail,
      durationMinutes: input.generated.durationMinutes,
      timerEnabled: input.timerEnabled,
      instructions: input.generated.instructions,
      assessmentProfile: input.generated.assessmentProfile,
      questions: input.generated.questions,
      choiceGroups: input.generated.choiceGroups,
      totalMarks: input.generated.totalMarks,
      markScheme: input.generated.markScheme,
      preparedAt: Date.now(),
      gradeGuidance: input.generated.gradeGuidance,
      examinerInsights: input.generated.examinerInsights,
      attemptCount: 0,
    });
    await withTimeout(
      setDoc(practicePaperRef(input.userId, notebook.id), payload),
      WRITE_MS,
      "Save generated practice paper"
    );
    await updateNotebook(input.userId, notebook.id, { pastPaperId: notebook.id });
    invalidateDashboardData(input.userId);
    return {
      notebook: { ...notebook, pastPaperId: notebook.id },
      pages,
      paper: mapPracticePaperData(notebook.id, payload),
    };
  } catch (error) {
    await updateNotebook(input.userId, notebook.id, { archived: true }).catch(
      () => undefined
    );
    throw error;
  }
}

export async function createUploadedPracticePaper(input: {
  userId: string;
  notebook: Notebook;
  sourceIds: string[];
  sourceLabels: string[];
  markSchemeSourceId?: string;
  durationMinutes?: number;
  timerEnabled: boolean;
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
    timerEnabled: input.timerEnabled,
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

export async function updatePracticePaper(
  userId: string,
  notebookId: string,
  input: Partial<{
    status: PracticePaperStatus;
    startedAt: number;
    submittedAt: number;
    markedAt: number;
    preparedAt: number;
    assessmentProfile: PracticePaper["assessmentProfile"];
    questions: PracticePaper["questions"];
    choiceGroups: PracticePaper["choiceGroups"];
    totalMarks: number;
    markScheme: PracticePaper["markScheme"];
    result: PracticePaperResult;
    gradeGuidance: PracticePaper["gradeGuidance"];
    examinerInsights: string[];
    activeAttemptId: string;
    attemptCount: number;
    title: string;
    durationMinutes: number;
  }>
) {
  await withTimeout(
    updateDoc(practicePaperRef(userId, notebookId), {
      ...input,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Update practice paper"
  );
  invalidateDashboardData(userId);
}

function practicePaperAttemptRef(userId: string, attemptId: string) {
  return doc(db, "users", userId, "practicePaperAttempts", attemptId);
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
  const now = Date.now();
  const attemptNumber = paper.attemptCount + 1;
  const attemptDocument = doc(collection(db, "users", userId, "practicePaperAttempts"));
  const batch = writeBatch(db);
  if (options.clearPreviousWork) {
    const pages = await withTimeout(
      getDocs(query(
        collection(db, "users", userId, "notebookPages"),
        where("notebookId", "==", paper.notebookId)
      )),
      LOAD_MS,
      "Load paper pages for retake"
    );
    pages.docs.forEach((page) => {
      batch.update(page.ref, {
        typedContent: null,
        textBlocks: [],
        inkData: null,
        strokeData: null,
        thumbnail: null,
        status: "blank",
        contentRevision: increment(1),
        updatedAt: now,
      });
      batch.delete(doc(db, "users", userId, "notebookPageInk", page.id));
    });
    batch.update(doc(db, "users", userId, "notebooks", paper.notebookId), {
      previewInkSvg: null,
      previewPageId: null,
      updatedAt: now,
    });
  }
  const attempt: Omit<PracticePaperAttempt, "id"> = {
    paperId: paper.id,
    notebookId: paper.notebookId,
    paperTitle: paper.title,
    attemptNumber,
    status: "in_progress",
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(attemptDocument, attempt);
  batch.update(practicePaperRef(userId, paper.notebookId), {
    status: "in_progress",
    activeAttemptId: attemptDocument.id,
    attemptCount: attemptNumber,
    startedAt: now,
    submittedAt: null,
    markedAt: null,
    result: null,
    updatedAt: now,
  });
  await withTimeout(batch.commit(), WRITE_MS, "Start paper attempt");
  invalidateDashboardData(userId);
  return mapPracticePaperData(paper.id, {
    ...paper,
    status: "in_progress",
    activeAttemptId: attemptDocument.id,
    attemptCount: attemptNumber,
    startedAt: now,
    submittedAt: null,
    markedAt: null,
    result: null,
    updatedAt: now,
  });
}

export async function submitPracticePaperAttempt(
  userId: string,
  paper: PracticePaper
) {
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(practicePaperRef(userId, paper.notebookId), {
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
  });
  if (paper.activeAttemptId) {
    batch.update(practicePaperAttemptRef(userId, paper.activeAttemptId), {
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
    });
  }
  await withTimeout(batch.commit(), WRITE_MS, "Submit paper attempt");
  return now;
}

export async function correctPracticePaperMark(input: {
  userId: string;
  paper: PracticePaper;
  questionId: string;
  awardedMarks: number;
  reason: string;
}) {
  if (!input.paper.result) throw new Error("This paper has not been marked yet.");
  const result = applyPracticePaperMarkCorrection(
    input.paper.result,
    input.questionId,
    input.awardedMarks,
    input.reason,
    input.paper.gradeGuidance
  );
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(practicePaperRef(input.userId, input.paper.notebookId), {
    result,
    updatedAt: now,
  });
  if (input.paper.activeAttemptId) {
    batch.update(practicePaperAttemptRef(input.userId, input.paper.activeAttemptId), {
      result,
      updatedAt: now,
    });
  }
  await withTimeout(batch.commit(), WRITE_MS, "Correct paper mark");
  return { ...input.paper, result, updatedAt: now };
}

export async function updatePracticePaperDefinition(input: {
  userId: string;
  paper: PracticePaper;
  title: string;
  durationMinutes: number;
  assessmentProfile: PracticePaper["assessmentProfile"];
  questions: PracticePaper["questions"];
  choiceGroups: PracticePaper["choiceGroups"];
  markScheme: PracticePaper["markScheme"];
}) {
  if (input.paper.attemptCount > 0 || input.paper.status !== "ready") {
    throw new Error("A paper can only be edited before its first attempt.");
  }
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(practicePaperRef(input.userId, input.paper.notebookId), {
    title: input.title.trim().slice(0, 160),
    durationMinutes: Math.max(0, Math.min(360, Math.round(input.durationMinutes))),
    assessmentProfile: input.assessmentProfile,
    questions: input.questions,
    choiceGroups: input.choiceGroups,
    markScheme: input.markScheme,
    updatedAt: now,
  });
  batch.update(doc(db, "users", input.userId, "notebooks", input.paper.notebookId), {
    title: input.title.trim().slice(0, 160),
    updatedAt: now,
  });
  const pages = await getDocs(query(
    collection(db, "users", input.userId, "notebookPages"),
    where("notebookId", "==", input.paper.notebookId)
  ));
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));
  pages.docs.forEach((page) => {
    const questionId = page.data().linkedQuestionId as string | undefined;
    const question = questionId ? questionsById.get(questionId) : undefined;
    if (question) {
      batch.update(page.ref, {
        title: question.label,
        questionPrompt: formatQuestionPrompt(question),
        questionAssets: question.assets,
        updatedAt: now,
      });
    }
  });
  await withTimeout(batch.commit(), WRITE_MS, "Update paper details");
  return mapPracticePaperData(input.paper.id, {
    ...input.paper,
    title: input.title,
    durationMinutes: input.durationMinutes,
    assessmentProfile: input.assessmentProfile,
    questions: input.questions,
    choiceGroups: input.choiceGroups,
    markScheme: input.markScheme,
    updatedAt: now,
  });
}
