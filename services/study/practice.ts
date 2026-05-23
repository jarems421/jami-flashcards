import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  mapAttemptData,
  mapQuestionData,
  normalizeConfidence,
  type Attempt,
  type Question,
} from "@/lib/practice/questions";
import {
  getAttemptMasteryWeight,
  getMasteryScoreDelta,
  MASTERY_ALGORITHM_VERSION,
} from "@/lib/practice/mastery";
import { recordMasteryEvent } from "@/services/study/mastery";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function questionsCollection(userId: string) {
  return collection(db, "users", userId, "questions");
}

function attemptsCollection(userId: string) {
  return collection(db, "users", userId, "attempts");
}

export async function getQuestions(userId: string): Promise<Question[]> {
  const snapshot = await withTimeout(
    getDocs(query(questionsCollection(userId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load practice questions"
  );

  return snapshot.docs.map((questionDoc) =>
    mapQuestionData(questionDoc.id, questionDoc.data() as Record<string, unknown>)
  );
}

export async function getActiveQuestions(userId: string): Promise<Question[]> {
  const questions = await getQuestions(userId);
  return questions.filter((question) => question.contentStatus === "approved");
}

export async function createQuestion(
  userId: string,
  input: {
    questionText: string;
    answerText?: string;
    solutionText?: string;
    topicIds: string[];
    difficulty?: "easy" | "medium" | "hard";
    sourceIds?: string[];
  }
) {
  const questionText = input.questionText.trim();
  if (!questionText) {
    throw new Error("Question text is required.");
  }

  const now = Date.now();
  const docRef = await withTimeout(
    addDoc(questionsCollection(userId), {
      questionText: questionText.slice(0, 4_000),
      answerText: input.answerText?.trim() || null,
      solutionText: input.solutionText?.trim() || null,
      markScheme: null,
      topicIds: input.topicIds,
      difficulty: input.difficulty ?? null,
      sourceType: "manual",
      origin: "user-authored",
      contentStatus: "approved",
      reviewedAt: now,
      reviewedBy: userId,
      sourceIds: input.sourceIds ?? [],
      createdAt: now,
      updatedAt: now,
    }),
    WRITE_MS,
    "Create practice question"
  );

  return docRef.id;
}

export async function getAttempts(userId: string): Promise<Attempt[]> {
  const snapshot = await withTimeout(
    getDocs(query(attemptsCollection(userId), orderBy("createdAt", "desc"))),
    LOAD_MS,
    "Load practice attempts"
  );

  return snapshot.docs.map((attemptDoc) =>
    mapAttemptData(attemptDoc.id, attemptDoc.data() as Record<string, unknown>)
  );
}

export async function getRecentAttempts(userId: string, maxCount = 30): Promise<Attempt[]> {
  const snapshot = await withTimeout(
    getDocs(query(attemptsCollection(userId), orderBy("createdAt", "desc"), limit(maxCount))),
    LOAD_MS,
    "Load recent practice attempts"
  );

  return snapshot.docs.map((attemptDoc) =>
    mapAttemptData(attemptDoc.id, attemptDoc.data() as Record<string, unknown>)
  );
}

export async function createAttempt(
  userId: string,
  question: Question,
  input: {
    userAnswer: string;
    workingText?: string;
    isCorrect: boolean;
    confidence: number;
    timeSpentSeconds?: number;
    hintsUsed?: number;
    tutorUsed?: boolean;
    mistakeLabels?: string[];
  }
) {
  const now = Date.now();
  const confidence = normalizeConfidence(input.confidence);
  const attemptPayload = {
    questionId: question.id,
    userAnswer: input.userAnswer.trim().slice(0, 8_000),
    workingText: input.workingText?.trim().slice(0, 8_000) || null,
    isCorrect: input.isCorrect,
    confidence,
    timeSpentSeconds:
      typeof input.timeSpentSeconds === "number"
        ? Math.max(0, Math.round(input.timeSpentSeconds))
        : null,
    hintsUsed:
      typeof input.hintsUsed === "number" ? Math.max(0, Math.round(input.hintsUsed)) : 0,
    tutorUsed: input.tutorUsed === true,
    mistakeLabels: input.mistakeLabels ?? [],
    createdAt: now,
  };

  const docRef = await withTimeout(
    addDoc(attemptsCollection(userId), attemptPayload),
    WRITE_MS,
    "Save practice attempt"
  );

  const weight = getAttemptMasteryWeight({
    isCorrect: input.isCorrect,
    confidence,
    hintsUsed: input.hintsUsed,
    tutorUsed: input.tutorUsed,
  });

  await Promise.all(
    question.topicIds.map((topicId) =>
      recordMasteryEvent(userId, {
        topicId,
        sourceType: "question",
        sourceId: docRef.id,
        weight,
        scoreDelta: getMasteryScoreDelta(weight),
        reason: input.isCorrect
          ? "Practice attempt self-marked correct."
          : "Practice attempt self-marked incorrect.",
        algorithmVersion: MASTERY_ALGORITHM_VERSION,
        createdAt: now,
      })
    )
  );

  return docRef.id;
}
