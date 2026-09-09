import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import {
  EXAM_SESSION_MAX_QUESTIONS,
  examDocument,
  questionMatchesExamCourse,
  type ExamCourseSelection,
  examBoardAppliesTo,
  type ExamDifficulty,
  type ExamQuestion,
  type ExamSession,
} from "@/lib/practice/exam-questions";
import { isExamQuestionServable } from "@/lib/practice/exam-question-rights";
import { normalizeQuestionAssets } from "@/lib/practice/practice-papers";
import { generateExamGapQuestions } from "@/services/practice/exam-gap-generation.server";
import { projectExamAttempt, projectExamSessionQuestion } from "@/lib/practice/exam-projections";

const CANDIDATE_LIMIT = 200;

function normalizeSubjectKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mapQuestion(id: string, data: Record<string, unknown>): ExamQuestion | null {
  const marks = typeof data.marks === "number" ? Math.round(data.marks) : 0;
  const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
  if (!id || !prompt || marks < 1 || marks > 100) return null;
  return {
    ...(data as unknown as ExamQuestion),
    id,
    marks,
    prompt,
    label: typeof data.label === "string" ? data.label.slice(0, 120) : "Question",
    assets: normalizeQuestionAssets(data.assets),
    topicIds: Array.isArray(data.topicIds)
      ? data.topicIds.filter((item): item is string => typeof item === "string").slice(0, 40)
      : [],
    selectionKey:
      typeof data.selectionKey === "number" && Number.isFinite(data.selectionKey)
        ? data.selectionKey
        : 0,
  };
}

function hasCurrentRights(question: ExamQuestion) {
  return isExamQuestionServable(question);
}

async function loadEligibleQuestions(input: {
  subjectKey: string;
  studyLevel: string;
  specificationId: string;
  course: ExamCourseSelection;
  difficulty: ExamDifficulty;
  topicIds: string[];
}) {
  const snapshot = await getAdminDb()
    .collection("examQuestions")
    .where("subjectKey", "==", input.subjectKey)
    .where("studyLevel", "==", input.studyLevel)
    .where("provenance.specificationId", "==", input.specificationId)
    .where("difficulty", "==", input.difficulty)
    .where("status", "==", "published")
    .orderBy("selectionKey", "asc")
    .limit(CANDIDATE_LIMIT)
    .get();
  return snapshot.docs
    .map((doc) => mapQuestion(doc.id, doc.data()))
    .filter((item): item is ExamQuestion => Boolean(item))
    .filter(hasCurrentRights)
    .filter((question) => questionMatchesExamCourse(question, input.course))
    .filter((question) =>
      input.topicIds.length === 0 ||
      input.topicIds.some((topicId) => question.topicIds.includes(topicId))
    );
}

async function loadContext(uid: string, folderId: string) {
  const snapshot = await getAdminDb()
    .collection("users").doc(uid).collection("studyFolders").doc(folderId).get();
  if (!snapshot.exists) throw new ExamQuestionBankError("Folder not found.", 404, "folder_not_found");
  const folder = mapStudyFolderData(snapshot.id, snapshot.data() ?? {});
  if (!folder.studyLevel || !examBoardAppliesTo(folder.studyLevel)) {
    throw new ExamQuestionBankError("Past Paper Practice is for school qualifications.", 400, "unsupported_level");
  }
  if (!folder.subject || !folder.examCourse) {
    throw new ExamQuestionBankError("Add this folder's exam course first.", 409, "course_required");
  }
  const catalogue = await getAdminDb().collection("examFormatCatalogue").where("board", "==", folder.examCourse.board).limit(300).get();
  const matches = catalogue.docs.map((doc) => doc.data()).filter((item) =>
    item.status === "current" && item.qualification === folder.examCourse!.qualification &&
    item.specificationCode === folder.examCourse!.specificationId);
  if (!matches.length || (matches.some((item) => item.tier) && !matches.some((item) => item.tier === folder.examCourse!.tier))) {
    throw new ExamQuestionBankError("Choose a current course and tier for this folder.", 409, "course_required");
  }
  return { folder, subjectKey: normalizeSubjectKey(folder.subject) };
}

export class ExamQuestionBankError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Set on a coverage shortage, so the caller can go looking for papers. */
    readonly course?: ExamCourseSelection,
    /** What the bank could actually supply, for the start-short offer. */
    readonly availableMix?: Record<ExamDifficulty, number>
  ) {
    super(message);
  }
}

export async function getExamQuestionAvailability(input: {
  uid: string;
  folderId: string;
  topicIds?: string[];
}) {
  const { folder, subjectKey } = await loadContext(input.uid, input.folderId);
  const topicIds = input.topicIds ?? [];
  const loadDifficulty = (difficulty: ExamDifficulty) => loadEligibleQuestions({
    subjectKey,
    studyLevel: folder.studyLevel!,
    specificationId: folder.examCourse!.specificationId,
    course: folder.examCourse!,
    difficulty,
    topicIds,
  });
  const [easy, medium, hard, topicSnapshot] = await Promise.all([
    loadDifficulty("easy"),
    loadDifficulty("medium"),
    loadDifficulty("hard"),
    getAdminDb().collection("examSpecificationTopics").doc(folder.examCourse!.specificationId).get(),
  ]);
  const rawTopics = topicSnapshot.data()?.topics;
  const topics = Array.isArray(rawTopics) ? rawTopics.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, unknown>).id as string : "";
    const label = typeof (item as Record<string, unknown>).label === "string" ? (item as Record<string, unknown>).label as string : "";
    return id && label ? [{ id: id.slice(0, 120), label: label.slice(0, 160) }] : [];
  }).slice(0, 200) : [];
  return {
    folder: {
      id: folder.id,
      name: folder.name,
      subject: folder.subject,
      studyLevel: folder.studyLevel,
      course: folder.examCourse,
    },
    counts: { easy: easy.length, medium: medium.length, hard: hard.length },
    topics,
    topicIds,
  };
}

export async function createExamSession(input: {
  uid: string;
  folderId: string;
  mix: Record<ExamDifficulty, number>;
  topicIds?: string[];
  originNotebookId?: string;
  allowGenerated?: boolean;
  useAvailableOnly?: boolean;
}) {
  const total = input.mix.easy + input.mix.medium + input.mix.hard;
  if (total < 1 || total > EXAM_SESSION_MAX_QUESTIONS) {
    throw new ExamQuestionBankError("Choose between 1 and 20 questions.", 400, "invalid_mix");
  }
  const { folder, subjectKey } = await loadContext(input.uid, input.folderId);
  const recent = await getAdminDb().collection("users").doc(input.uid)
    .collection("examAttempts").orderBy("updatedAt", "desc").limit(500).get();
  const recentIds = new Set(recent.docs.map((doc) => doc.data().questionId).filter((id): id is string => typeof id === "string"));
  const selected: ExamQuestion[] = [];
  const missing: Partial<Record<ExamDifficulty, number>> = {};
  let requestedMix = input.mix;
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    const wanted = input.mix[difficulty];
    if (!wanted) continue;
    const candidates = await loadEligibleQuestions({
      subjectKey,
      studyLevel: folder.studyLevel!,
      specificationId: folder.examCourse!.specificationId,
      course: folder.examCourse!,
      difficulty,
      topicIds: input.topicIds ?? [],
    });
    const unseen = candidates.filter((question) => !recentIds.has(question.id));
    const seen = candidates.filter((question) => recentIds.has(question.id));
    const chosen = [...unseen, ...seen].slice(0, wanted);
    selected.push(...chosen);
    if (chosen.length < wanted) missing[difficulty] = wanted - chosen.length;
  }
  if (Object.keys(missing).length > 0) {
    if (input.allowGenerated) {
      selected.push(...await generateExamGapQuestions({ uid: input.uid, subject: folder.subject!, subjectKey, studyLevel: folder.studyLevel!, course: folder.examCourse!, missing, topicIds: input.topicIds ?? [] }));
    } else if (input.useAvailableOnly && selected.length > 0) {
      // Starting short is a choice the student made, so the session records the
      // mix it actually holds rather than the one that was asked for.
      requestedMix = {
        easy: selected.filter((question) => question.difficulty === "easy").length,
        medium: selected.filter((question) => question.difficulty === "medium").length,
        hard: selected.filter((question) => question.difficulty === "hard").length,
      };
    } else {
      throw new ExamQuestionBankError(
        "There are not enough matching past-paper questions yet.",
        409,
        `coverage_gap:${JSON.stringify(missing)}`,
        folder.examCourse!,
        {
          easy: Math.min(input.mix.easy, selected.filter((question) => question.difficulty === "easy").length),
          medium: Math.min(input.mix.medium, selected.filter((question) => question.difficulty === "medium").length),
          hard: Math.min(input.mix.hard, selected.filter((question) => question.difficulty === "hard").length),
        }
      );
    }
  }

  const db = getAdminDb();
  const sessionRef = db.collection("users").doc(input.uid).collection("examSessions").doc();
  const now = Date.now();
  const questions = selected.map((question, index) =>
    projectExamSessionQuestion(question, `${sessionRef.id}_${index + 1}_1`)
  );
  const session: ExamSession = {
    id: sessionRef.id,
    userId: input.uid,
    folderId: folder.id,
    folderName: folder.name,
    subject: folder.subject!,
    studyLevel: folder.studyLevel!,
    course: folder.examCourse!,
    requestedMix,
    topicIds: input.topicIds ?? [],
    questions,
    status: "active",
    currentQuestionId: questions[0]?.id,
    answeredCount: 0,
    awardedTotal: 0,
    maxTotal: questions.reduce((sum, question) => sum + question.marks, 0),
    originNotebookId: input.originNotebookId,
    createdAt: now,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.set(sessionRef, examDocument(session));
  for (const question of questions) {
    const attemptRef = db.collection("users").doc(input.uid).collection("examAttempts").doc(question.attemptId);
    batch.set(attemptRef, {
      id: question.attemptId,
      userId: input.uid,
      sessionId: session.id,
      questionId: question.id,
      attemptNumber: 1,
      answerText: "",
      status: "draft",
      workingIncluded: false,
      reviewUsed: false,
      startedAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return session;
}

export async function getExamSession(uid: string, sessionId: string) {
  const db = getAdminDb();
  const [sessionSnapshot, attemptsSnapshot] = await Promise.all([
    db.collection("users").doc(uid).collection("examSessions").doc(sessionId).get(),
    db.collection("users").doc(uid).collection("examAttempts")
      .where("sessionId", "==", sessionId).orderBy("updatedAt", "desc").get(),
  ]);
  if (!sessionSnapshot.exists) throw new ExamQuestionBankError("Session not found.", 404, "session_not_found");
  return {
    session: sessionSnapshot.data() as ExamSession,
    attempts: attemptsSnapshot.docs.map((doc) => projectExamAttempt(doc.id, doc.data())),
  };
}

export async function listExamSessions(uid: string, folderId?: string) {
  let query: FirebaseFirestore.Query = getAdminDb().collection("users").doc(uid).collection("examSessions");
  if (folderId) query = query.where("folderId", "==", folderId);
  const snapshot = await query.orderBy("updatedAt", "desc").limit(100).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
