import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  buildPastPaperPayload,
  buildPracticeSetPayload,
  mapPastPaperData,
  mapPracticeSetData,
  type PastPaper,
  type PracticeSet,
  type PracticeSetType,
} from "@/lib/workspace/practice-sets";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function practiceSetsCollection(userId: string) {
  return collection(db, "users", userId, "practiceSets");
}

function pastPapersCollection(userId: string) {
  return collection(db, "users", userId, "pastPapers");
}

export async function getActivePracticeSets(userId: string): Promise<PracticeSet[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");

  const snapshot = await withTimeout(
    getDocs(query(practiceSetsCollection(normalizedUserId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load practice sets"
  );

  return snapshot.docs
    .map((practiceSetDoc) =>
      mapPracticeSetData(practiceSetDoc.id, practiceSetDoc.data() as Record<string, unknown>)
    )
    .filter((practiceSet) => !practiceSet.archived);
}

export async function getPracticeSetsForFolder(userId: string, folderId: string) {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedFolderId) throw new Error("Missing folderId.");

  const snapshot = await withTimeout(
    getDocs(
      query(
        practiceSetsCollection(normalizedUserId),
        where("folderId", "==", normalizedFolderId)
      )
    ),
    LOAD_MS,
    "Load folder practice sets"
  );

  return snapshot.docs
    .map((practiceSetDoc) =>
      mapPracticeSetData(practiceSetDoc.id, practiceSetDoc.data() as Record<string, unknown>)
    )
    .filter((practiceSet) => !practiceSet.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createPracticeSet(
  userId: string,
  input: {
    folderId: string;
    title: string;
    type?: PracticeSetType;
    topicIds?: string[];
    sourceIds?: string[];
    questionIds?: string[];
    notebookId?: string;
  }
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");

  const payload = buildPracticeSetPayload(input);
  const docRef = await withTimeout(
    addDoc(practiceSetsCollection(normalizedUserId), payload),
    WRITE_MS,
    "Create practice set"
  );

  return mapPracticeSetData(docRef.id, payload);
}

export async function updatePracticeSet(
  userId: string,
  practiceSetId: string,
  input: Partial<{
    title: string;
    type: PracticeSetType;
    topicIds: string[];
    sourceIds: string[];
    questionIds: string[];
    notebookId: string;
    archived: boolean;
  }>
) {
  const normalizedUserId = userId.trim();
  const normalizedPracticeSetId = practiceSetId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedPracticeSetId) throw new Error("Missing practiceSetId.");

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "practiceSets", normalizedPracticeSetId), {
      ...input,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Update practice set"
  );
}

export async function getActivePastPapers(userId: string): Promise<PastPaper[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");

  const snapshot = await withTimeout(
    getDocs(query(pastPapersCollection(normalizedUserId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load past papers"
  );

  return snapshot.docs
    .map((pastPaperDoc) =>
      mapPastPaperData(pastPaperDoc.id, pastPaperDoc.data() as Record<string, unknown>)
    )
    .filter((pastPaper) => !pastPaper.archived);
}

export async function getPastPapersForFolder(userId: string, folderId: string) {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedFolderId) throw new Error("Missing folderId.");

  const snapshot = await withTimeout(
    getDocs(
      query(
        pastPapersCollection(normalizedUserId),
        where("folderId", "==", normalizedFolderId)
      )
    ),
    LOAD_MS,
    "Load folder past papers"
  );

  return snapshot.docs
    .map((pastPaperDoc) =>
      mapPastPaperData(pastPaperDoc.id, pastPaperDoc.data() as Record<string, unknown>)
    )
    .filter((pastPaper) => !pastPaper.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createPastPaper(
  userId: string,
  input: {
    folderId: string;
    title: string;
    year?: string;
    module?: string;
    sourceId?: string;
    fileName?: string;
    fileType?: string;
    pageCount?: number;
    notebookId?: string;
  }
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");

  const payload = buildPastPaperPayload(input);
  const docRef = await withTimeout(
    addDoc(pastPapersCollection(normalizedUserId), payload),
    WRITE_MS,
    "Create past paper"
  );

  return mapPastPaperData(docRef.id, payload);
}

export async function updatePastPaper(
  userId: string,
  pastPaperId: string,
  input: Partial<{
    title: string;
    year: string;
    module: string;
    sourceId: string;
    fileName: string;
    fileType: string;
    pageCount: number;
    notebookId: string;
    archived: boolean;
  }>
) {
  const normalizedUserId = userId.trim();
  const normalizedPastPaperId = pastPaperId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedPastPaperId) throw new Error("Missing pastPaperId.");

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "pastPapers", normalizedPastPaperId), {
      ...input,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Update past paper"
  );
}
