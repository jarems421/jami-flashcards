import { addDoc, collection, getDocs, orderBy, query, updateDoc, doc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
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
  topicIds: string[];
  origin: ContentOrigin;
  contentStatus: ContentStatus;
  reviewedAt?: number;
  reviewedBy?: string;
  sourceType?: "card" | "question" | "tutor" | "manual";
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
    topicIds: normalizeStringArray(data.topicIds, 20, 120),
    origin: isContentOrigin(data.origin) ? data.origin : "ai-assisted",
    contentStatus: isContentStatus(data.contentStatus) ? data.contentStatus : "draft",
    reviewedAt: typeof data.reviewedAt === "number" ? data.reviewedAt : undefined,
    reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : undefined,
    sourceType:
      data.sourceType === "card" ||
      data.sourceType === "question" ||
      data.sourceType === "tutor" ||
      data.sourceType === "manual"
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
    sourceType?: "card" | "question" | "tutor" | "manual";
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
