import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import { mapStudyFolderData, type StudyFolder } from "@/lib/workspace/study-folders";
import { examDocument, type ExamSession } from "@/lib/practice/exam-questions";
import { projectExamSession, projectExamSessionQuestion } from "@/lib/practice/exam-projections";
import {
  isReadyPracticeSet,
  normalizePracticeSetInfo,
  PRACTICE_SET_DEFAULT_COUNT,
  PRACTICE_SET_MAX_COUNT,
  PRACTICE_SET_MAX_FOCUS_LENGTH,
  practiceSetMix,
  practiceSetTitle,
  type PracticeSetAction,
  type PracticeSetInfo,
  type PracticeSetOrigin,
} from "@/lib/practice/practice-sets";
import { normalizeStudyLevel, type StudyLevel } from "@/lib/profile/study-level";
import { normalizeStudySubjects } from "@/lib/profile/study-subjects";
import { mapSourceData } from "@/lib/material/sources";
import { generateExamGapQuestions } from "@/services/practice/exam-gap-generation.server";
import { loadPracticeSetCourse } from "@/services/practice/exam-question-bank.server";
import { examGeneratedQuestionRefs } from "@/services/practice/exam-evidence.server";

/** Everything a set's brief may carry, so a long conversation cannot crowd out the focus. */
const MAX_CONTEXT_CHARACTERS = 14_000;
/** Ready sets worth listing; a student with more than this has plenty to start. */
const READY_LIST_LIMIT = 30;

export class PracticeSetError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

function normalizeSubjectKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

function quoted(value: string) {
  return JSON.stringify(value.replace(/\s+/g, " ").trim().slice(0, 200));
}

/**
 * Who this set is for, from everything the account and folder say.
 *
 * The level is the one thing a set without a course cannot get wrong, so it
 * is taken from the folder first, then the account -- and where neither says,
 * the writer is told so and asked to judge it from the material rather than
 * being handed a default that is right for nobody in particular.
 */
async function loadAudience(uid: string, folderId: string | undefined) {
  const userRef = getAdminDb().collection("users").doc(uid);
  const [userSnapshot, folderSnapshot] = await Promise.all([
    userRef.get(),
    folderId ? userRef.collection("studyFolders").doc(folderId).get() : Promise.resolve(null),
  ]);
  if (folderId && !folderSnapshot?.exists) {
    throw new PracticeSetError("That folder could not be found.", 404, "folder_not_found");
  }
  const folder: StudyFolder | null = folderSnapshot?.exists
    ? mapStudyFolderData(folderSnapshot.id, folderSnapshot.data() ?? {})
    : null;
  const userData = userSnapshot.exists ? userSnapshot.data() ?? {} : {};
  const accountLevel = normalizeStudyLevel(userData.defaultStudyLevel);
  const studyLevel: StudyLevel | undefined = folder?.studyLevel ?? accountLevel;
  const subjects = normalizeStudySubjects(userData.studySubjects);
  return { folder, studyLevel, subjects };
}

export type CreatePracticeSetInput = {
  uid: string;
  origin: PracticeSetOrigin;
  /** What every question is on. */
  focus: string;
  title?: string;
  count?: number;
  folderId?: string;
  /**
   * Conversation, source extracts and anything else the questions should be
   * pitched against. Untrusted and fenced by the writer; bounded here.
   */
  context?: string;
  sourceIds?: string[];
  threadId?: string;
  messageId?: string;
  /** Specification headings, honoured only where the folder has that course. */
  topicIds?: string[];
  conceptIds?: string[];
};

/**
 * Writes a practice set and saves it as a session ready to start.
 *
 * Where the folder has an exam course the questions are written for it, so
 * they read like its papers. Where it has none they are written for the level,
 * subject and material the student is actually working with -- which is most
 * of what stops a university student being handed GCSE questions.
 *
 * The questions are filed under this session alone. A practice set is
 * something to do, not a collection that grows: its questions are never drawn
 * into another session.
 */
export async function createPracticeSet(input: CreatePracticeSetInput): Promise<ExamSession> {
  const focus = input.focus.replace(/\s+/g, " ").trim().slice(0, PRACTICE_SET_MAX_FOCUS_LENGTH);
  if (!focus) throw new PracticeSetError("Say what the practice set should cover.", 400, "focus_required");
  const count = Math.max(1, Math.min(PRACTICE_SET_MAX_COUNT, Math.round(input.count ?? PRACTICE_SET_DEFAULT_COUNT)));

  const { folder, studyLevel, subjects } = await loadAudience(input.uid, input.folderId);
  const coursed = folder
    ? await loadPracticeSetCourse({
        uid: input.uid,
        folderId: folder.id,
        topicIds: input.topicIds,
        conceptIds: input.conceptIds,
      })
    : null;

  const subject =
    coursed?.subject ||
    folder?.subject ||
    folder?.name ||
    subjects[0] ||
    "General study";
  const knownLevel = coursed?.folder.studyLevel ?? studyLevel;
  // Only a placeholder until the writer reports the level it judged.
  let level: StudyLevel = knownLevel ?? "post-16-equivalent";
  const contextLines = [
    `Subject: ${quoted(subject)}`,
    folder ? `Folder: ${quoted(folder.name)}${folder.subject ? `, subject ${quoted(folder.subject)}` : ""}` : "",
    subjects.length > 0 ? `The student's courses: ${subjects.map(quoted).join(", ")}` : "",
    (input.context ?? "").trim(),
  ].filter(Boolean);
  const context = contextLines.join("\n").slice(0, MAX_CONTEXT_CHARACTERS);

  const db = getAdminDb();
  const sessionRef = db.collection("users").doc(input.uid).collection("examSessions").doc();
  const mix = practiceSetMix(count);
  const written = await generateExamGapQuestions({
    uid: input.uid,
    subject,
    subjectKey: coursed?.subjectKey ?? normalizeSubjectKey(subject),
    studyLevel: level,
    ...(coursed ? { course: coursed.course } : {}),
    missing: mix,
    topicIds: coursed?.topicIds ?? [],
    conceptIds: coursed?.conceptIds ?? [],
    brief: { focus, context },
    paperId: `jami-set-${sessionRef.id}`,
    inferLevel: !coursed && !knownLevel,
    onLevelInferred: (inferred) => {
      level = inferred;
    },
  });
  if (written.length === 0) {
    throw new PracticeSetError("Jami could not write that practice set just now.", 502, "generation_failed");
  }

  const now = Date.now();
  const questions = written.map((question, index) =>
    projectExamSessionQuestion(question, `${sessionRef.id}_${index + 1}_1`)
  );
  const practiceSet: PracticeSetInfo = {
    origin: input.origin,
    status: "ready",
    title: practiceSetTitle(input.title?.trim() || focus),
    focus,
    ...(input.sourceIds?.length ? { sourceIds: input.sourceIds.slice(0, 15) } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
  };
  const session: ExamSession = {
    id: sessionRef.id,
    userId: input.uid,
    folderId: folder?.id ?? "",
    folderName: folder?.name ?? "No folder",
    subject,
    studyLevel: level,
    ...(coursed ? { course: coursed.course } : {}),
    requestedMix: mix,
    topicIds: coursed?.topicIds ?? [],
    conceptIds: coursed?.conceptIds ?? [],
    questions,
    status: "active",
    currentQuestionId: questions[0]?.id,
    answeredCount: 0,
    awardedTotal: 0,
    assessedTotal: 0,
    maxTotal: questions.reduce((sum, question) => sum + question.marks, 0),
    practiceSet,
    createdAt: now,
    updatedAt: now,
  };
  const batch = db.batch();
  batch.set(sessionRef, examDocument(session));
  for (const question of questions) {
    batch.set(db.collection("users").doc(input.uid).collection("examAttempts").doc(question.attemptId), {
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
  return projectExamSession(session);
}

/** How much of a source a set is written from; the same bound source drafting uses. */
const SOURCE_EXTRACT_CHARACTERS = 12_000;

/**
 * A source, as a practice set's scope and context.
 *
 * Read by the server under the student's own uid, never taken from the
 * request, so a set can only be written from a source the student owns. A
 * source saved as a link with no text has nothing to write from.
 */
export async function loadSourcePracticeSetScope(uid: string, sourceId: string) {
  const snapshot = await getAdminDb()
    .collection("users").doc(uid).collection("sources").doc(sourceId).get();
  if (!snapshot.exists) throw new PracticeSetError("That source could not be found.", 404, "source_not_found");
  const source = mapSourceData(snapshot.id, snapshot.data() ?? {});
  if (!source.contentText) {
    throw new PracticeSetError(
      "This source is saved as a reference only. Paste the relevant text before making questions from it.",
      400,
      "source_has_no_text"
    );
  }
  return {
    title: source.title,
    // Only a source in exactly one folder says which course it belongs to.
    folderId: source.folderIds.length === 1 ? source.folderIds[0] : undefined,
    context: `Source ${quoted(source.title)}:\n${source.contentText.slice(0, SOURCE_EXTRACT_CHARACTERS)}`,
  };
}

/** Sets waiting to be started, newest first. */
export async function listReadyPracticeSets(uid: string) {
  // Equality on one field only, so the automatic index serves it; order is applied here.
  const snapshot = await getAdminDb()
    .collection("users").doc(uid).collection("examSessions")
    .where("practiceSet.status", "==", "ready")
    .limit(READY_LIST_LIMIT * 2)
    .get();
  return snapshot.docs
    .map((doc) => ({ ...doc.data(), id: doc.id }) as ExamSession)
    .filter(isReadyPracticeSet)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, READY_LIST_LIMIT)
    .map(projectExamSession);
}



/**
 * Keeps or turns down a set.
 *
 * Turning one down ends it as abandoned only while nothing has been answered;
 * a set the student has worked on is their practice and stays in history.
 */
export async function updatePracticeSet(uid: string, sessionId: string, action: PracticeSetAction) {
  const ref = getAdminDb().collection("users").doc(uid).collection("examSessions").doc(sessionId);
  const updated = await getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new PracticeSetError("That practice set could not be found.", 404, "not_found");
    const session = { ...snapshot.data(), id: snapshot.id } as ExamSession;
    const practiceSet = normalizePracticeSetInfo(session.practiceSet);
    if (!practiceSet) throw new PracticeSetError("That session is not a practice set.", 400, "not_practice_set");
    const now = Date.now();
    const next: PracticeSetInfo =
      action === "accept"
        ? { ...practiceSet, acceptedAt: practiceSet.acceptedAt ?? now }
        : { ...practiceSet, status: "dismissed", dismissedAt: now };
    const abandon = action === "dismiss" && session.answeredCount === 0 && session.status === "active";
    transaction.update(ref, {
      practiceSet: examDocument(next),
      ...(abandon ? { status: "abandoned" } : {}),
      updatedAt: now,
    });
    return projectExamSession({
      ...session,
      practiceSet: next,
      ...(abandon ? { status: "abandoned" as const } : {}),
      updatedAt: now,
    });
  });
  if (updated.status === "abandoned" && updated.answeredCount === 0 && action === "dismiss") {
    await discardPracticeSetQuestions(uid, sessionId).catch(() => undefined);
  }
  return updated;
}

/**
 * A turned-down set's questions, deleted.
 *
 * They were written for this set alone and nothing else can reach them, so
 * keeping them would only be a collection of questions quietly growing under
 * the student. Best-effort: the set is already gone from their view.
 */
async function discardPracticeSetQuestions(uid: string, sessionId: string) {
  const refs = examGeneratedQuestionRefs(uid);
  const snapshot = await refs.questions.where("paperId", "==", `jami-set-${sessionId}`).limit(20).get();
  if (snapshot.empty) return;
  const batch = getAdminDb().batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    batch.delete(refs.secrets.doc(doc.id));
  }
  await batch.commit();
}
