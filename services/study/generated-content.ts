import { addDoc, collection, getDoc, getDocs, orderBy, query, updateDoc, doc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  buildFlashcardDraftCardData,
  buildPracticeQuestionDraftNotebookPageData,
} from "@/lib/practice/generated-content";
import { createNotebookPage, getNotebookById, getNotebookPages, updateNotebook } from "@/services/study/notebooks";
import {
  isContentOrigin,
  isContentStatus,
  normalizeOptionalString,
  normalizeStringArray,
  type ContentOrigin,
  type ContentStatus,
} from "@/lib/practice/content";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

export type GeneratedContentKind =
  | "flashcard"
  | "practice-question"
  | "topic-suggestion"
  | "summary"
  | "misconception-label"
  | "similar-question";

export type GeneratedContentDraft = {
  id: string;
  kind: GeneratedContentKind;
  title: string;
  front?: string;
  back?: string;
  questionText?: string;
  answerText?: string;
  solutionText?: string;
  topicIds: string[];
  origin: ContentOrigin;
  contentStatus: ContentStatus;
  reviewedAt?: number;
  reviewedBy?: string;
  sourceType?: "card" | "question" | "tutor" | "manual" | "source";
  sourceId?: string;
  createdAt: number;
  updatedAt: number;
};

function draftsCollection(userId: string) {
  return collection(db, "users", userId, "generatedContentDrafts");
}

function isGeneratedContentKind(value: unknown): value is GeneratedContentKind {
  return (
    value === "flashcard" ||
    value === "practice-question" ||
    value === "topic-suggestion" ||
    value === "summary" ||
    value === "misconception-label" ||
    value === "similar-question"
  );
}

export function mapGeneratedContentDraftData(
  id: string,
  data: Record<string, unknown>
): GeneratedContentDraft {
  return {
    id,
    kind: isGeneratedContentKind(data.kind) ? data.kind : "flashcard",
    title: normalizeOptionalString(data.title, 160) ?? "Untitled draft",
    front: normalizeOptionalString(data.front, 1_000),
    back: normalizeOptionalString(data.back, 4_000),
    questionText: normalizeOptionalString(data.questionText, 4_000),
    answerText: normalizeOptionalString(data.answerText, 4_000),
    solutionText: normalizeOptionalString(data.solutionText, 8_000),
    topicIds: normalizeStringArray(data.topicIds, 20, 120),
    origin: isContentOrigin(data.origin) ? data.origin : "ai-assisted",
    contentStatus: isContentStatus(data.contentStatus) ? data.contentStatus : "draft",
    reviewedAt: typeof data.reviewedAt === "number" ? data.reviewedAt : undefined,
    reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : undefined,
    sourceType:
      data.sourceType === "card" ||
      data.sourceType === "question" ||
      data.sourceType === "tutor" ||
      data.sourceType === "manual" ||
      data.sourceType === "source"
        ? data.sourceType
        : undefined,
    sourceId: normalizeOptionalString(data.sourceId, 160),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export async function getGeneratedContentDrafts(userId: string) {
  const snapshot = await withTimeout(
    getDocs(query(draftsCollection(userId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load generated content drafts"
  );

  return snapshot.docs.map((draftDoc) =>
    mapGeneratedContentDraftData(draftDoc.id, draftDoc.data() as Record<string, unknown>)
  );
}

export async function createFlashcardDraft(
  userId: string,
  input: {
    front: string;
    back: string;
    topicIds: string[];
    sourceType?: "card" | "question" | "tutor" | "manual" | "source";
    sourceId?: string;
  }
) {
  const now = Date.now();
  const docRef = await withTimeout(
    addDoc(draftsCollection(userId), {
      kind: "flashcard",
      title: input.front.slice(0, 120) || "Flashcard draft",
      front: input.front.slice(0, 1_000),
      back: input.back.slice(0, 4_000),
      topicIds: input.topicIds,
      origin: "ai-assisted",
      contentStatus: "draft",
      sourceType: input.sourceType ?? "tutor",
      sourceId: input.sourceId ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    WRITE_MS,
    "Create flashcard draft"
  );

  return docRef.id;
}

export async function createPracticeQuestionDraft(
  userId: string,
  input: {
    questionText: string;
    answerText?: string;
    solutionText?: string;
    topicIds: string[];
    sourceType?: "question" | "tutor" | "manual" | "source";
    sourceId?: string;
  }
) {
  const now = Date.now();
  const questionText = input.questionText.trim();
  if (!questionText) {
    throw new Error("Question text is required.");
  }

  const docRef = await withTimeout(
    addDoc(draftsCollection(userId), {
      kind: "practice-question",
      title: questionText.slice(0, 120) || "Practice question draft",
      questionText: questionText.slice(0, 4_000),
      answerText: input.answerText?.trim().slice(0, 4_000) || null,
      solutionText: input.solutionText?.trim().slice(0, 8_000) || null,
      topicIds: input.topicIds,
      origin: "source-derived",
      contentStatus: "draft",
      sourceType: input.sourceType ?? "source",
      sourceId: input.sourceId ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    WRITE_MS,
    "Create practice question draft"
  );

  return docRef.id;
}

export async function updateGeneratedContentDraftStatus(
  userId: string,
  draftId: string,
  status: "approved" | "rejected" | "archived"
) {
  await withTimeout(
    updateDoc(doc(db, "users", userId, "generatedContentDrafts", draftId), {
      contentStatus: status,
      reviewedAt: Date.now(),
      reviewedBy: userId,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Update generated content draft"
  );
}

export async function updateGeneratedContentDraftContent(
  userId: string,
  draftId: string,
  input: Partial<{
    front: string;
    back: string;
    questionText: string;
    answerText: string;
    solutionText: string;
    topicIds: string[];
  }>
) {
  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
  };
  if (typeof input.front === "string") payload.front = input.front.trim().slice(0, 1_000);
  if (typeof input.back === "string") payload.back = input.back.trim().slice(0, 4_000);
  if (typeof input.questionText === "string") payload.questionText = input.questionText.trim().slice(0, 4_000);
  if (typeof input.answerText === "string") payload.answerText = input.answerText.trim().slice(0, 4_000) || null;
  if (typeof input.solutionText === "string") payload.solutionText = input.solutionText.trim().slice(0, 8_000) || null;
  if (Array.isArray(input.topicIds)) payload.topicIds = input.topicIds;

  await withTimeout(
    updateDoc(doc(db, "users", userId, "generatedContentDrafts", draftId), payload),
    WRITE_MS,
    "Update generated draft content"
  );
}

export async function convertFlashcardDraftToCard(
  userId: string,
  input: {
    draftId: string;
    deckId: string;
  }
) {
  const normalizedUserId = userId.trim();
  const draftId = input.draftId.trim();
  const deckId = input.deckId.trim();

  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!draftId) {
    throw new Error("Missing draftId.");
  }
  if (!deckId) {
    throw new Error("Choose a destination deck first.");
  }

  const [draftSnapshot, deckSnapshot] = await Promise.all([
    withTimeout(
      getDoc(doc(db, "users", normalizedUserId, "generatedContentDrafts", draftId)),
      LOAD_MS,
      "Load flashcard draft"
    ),
    withTimeout(getDoc(doc(db, "decks", deckId)), LOAD_MS, "Load destination deck"),
  ]);

  if (!draftSnapshot.exists()) {
    throw new Error("Flashcard draft not found.");
  }

  const deckData = deckSnapshot.exists() ? deckSnapshot.data() : null;
  const deckOwner =
    typeof deckData?.userId === "string"
      ? deckData.userId
      : typeof deckData?.uid === "string"
        ? deckData.uid
        : "";
  if (!deckSnapshot.exists() || deckOwner !== normalizedUserId) {
    throw new Error("Destination deck not found.");
  }

  const draft = mapGeneratedContentDraftData(
    draftSnapshot.id,
    draftSnapshot.data() as Record<string, unknown>
  );
  const cardData = buildFlashcardDraftCardData(draft, {
    userId: normalizedUserId,
    deckId,
  });

  const cardRef = await withTimeout(
    addDoc(collection(db, "cards"), cardData),
    WRITE_MS,
    "Create card from flashcard draft"
  );

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "generatedContentDrafts", draftId), {
      contentStatus: "approved",
      reviewedAt: Date.now(),
      reviewedBy: normalizedUserId,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Approve flashcard draft"
  );

  return cardRef.id;
}

export async function convertPracticeQuestionDraftToNotebookPage(
  userId: string,
  input: {
    draftId: string;
    notebookId: string;
  }
) {
  const normalizedUserId = userId.trim();
  const draftId = input.draftId.trim();
  const notebookId = input.notebookId.trim();

  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!draftId) {
    throw new Error("Missing draftId.");
  }
  if (!notebookId) {
    throw new Error("Choose a destination notebook first.");
  }

  const [draftSnapshot, notebook] = await Promise.all([
    withTimeout(
      getDoc(doc(db, "users", normalizedUserId, "generatedContentDrafts", draftId)),
      LOAD_MS,
      "Load practice question draft"
    ),
    getNotebookById(normalizedUserId, notebookId),
  ]);

  if (!draftSnapshot.exists()) {
    throw new Error("Practice question draft not found.");
  }
  if (!notebook) {
    throw new Error("Destination notebook not found.");
  }

  const draft = mapGeneratedContentDraftData(
    draftSnapshot.id,
    draftSnapshot.data() as Record<string, unknown>
  );
  const pageData = buildPracticeQuestionDraftNotebookPageData(draft);
  const existingPages = await getNotebookPages(normalizedUserId, notebookId);

  const page = await createNotebookPage(normalizedUserId, {
    notebookId,
    folderId: notebook.folderId,
    pageNumber: existingPages.length + 1,
    title: pageData.title,
    pageType: pageData.pageType,
    questionPrompt: pageData.questionPrompt,
    typedContent: pageData.typedContent ?? undefined,
    linkedSourceId: pageData.linkedSourceId ?? undefined,
    pageColor: notebook.pageColor,
    status: pageData.status,
  });

  await updateNotebook(normalizedUserId, notebookId, {
    topicIds: Array.from(new Set([...notebook.topicIds, ...draft.topicIds])),
    sourceIds: draft.sourceId ? Array.from(new Set([...notebook.sourceIds, draft.sourceId])) : notebook.sourceIds,
  });

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "generatedContentDrafts", draftId), {
      contentStatus: "approved",
      reviewedAt: Date.now(),
      reviewedBy: normalizedUserId,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Approve practice question draft"
  );

  return page.id;
}
