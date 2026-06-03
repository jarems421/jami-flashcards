import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  buildSourcePayload,
  mapSourceData,
  type Source,
  type SourceType,
} from "@/lib/practice/sources";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function sourcesCollection(userId: string) {
  return collection(db, "users", userId, "sources");
}

export async function getSources(userId: string): Promise<Source[]> {
  const snapshot = await withTimeout(
    getDocs(query(sourcesCollection(userId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load sources"
  );

  return snapshot.docs.map((sourceDoc) =>
    mapSourceData(sourceDoc.id, sourceDoc.data() as Record<string, unknown>)
  );
}

export async function getActiveSources(userId: string): Promise<Source[]> {
  const sources = await getSources(userId);
  return sources.filter((source) => source.status === "active");
}

export async function createSource(
  userId: string,
  input: {
    title: string;
    type: SourceType;
    subject?: string;
    folderIds?: string[];
    topicIds?: string[];
    contentText?: string;
    externalUrl?: string;
    fileName?: string;
    fileType?: string;
    storagePath?: string;
    sizeBytes?: number;
  }
) {
  const payload = buildSourcePayload(userId, input);
  const docRef = await withTimeout(
    addDoc(sourcesCollection(userId), payload),
    WRITE_MS,
    "Create source"
  );

  return docRef.id;
}

export async function updateSource(
  userId: string,
  sourceId: string,
  input: Partial<{
    title: string;
    subject: string;
    folderIds: string[];
    topicIds: string[];
    contentText: string;
    externalUrl: string;
    fileName: string;
    fileType: string;
    storagePath: string;
    sizeBytes: number;
    status: "active" | "archived";
  }>
) {
  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (typeof input.title === "string") payload.title = input.title.trim().slice(0, 160);
  if (typeof input.subject === "string") payload.subject = input.subject.trim().slice(0, 120) || null;
  if (Array.isArray(input.folderIds)) payload.folderIds = input.folderIds;
  if (Array.isArray(input.topicIds)) payload.topicIds = input.topicIds;
  if (typeof input.contentText === "string") payload.contentText = input.contentText.trim().slice(0, 20_000) || null;
  if (typeof input.externalUrl === "string") payload.externalUrl = input.externalUrl.trim().slice(0, 1_000) || null;
  if (typeof input.fileName === "string") payload.fileName = input.fileName.trim().slice(0, 240) || null;
  if (typeof input.fileType === "string") payload.fileType = input.fileType.trim().slice(0, 120) || null;
  if (typeof input.storagePath === "string") payload.storagePath = input.storagePath.trim().slice(0, 1_000) || null;
  if (typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)) {
    payload.sizeBytes = Math.max(0, Math.round(input.sizeBytes));
  }
  if (input.status === "active" || input.status === "archived") payload.status = input.status;

  await withTimeout(
    updateDoc(doc(db, "users", userId, "sources", sourceId), payload),
    WRITE_MS,
    "Update source"
  );
}
