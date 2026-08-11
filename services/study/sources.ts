import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { requestSourceIndex } from "@/services/ai/source-index";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  readThroughCache,
  type CachedReadOptions,
} from "@/services/cache/read-through";
import {
  invalidateLegacyActiveRecords,
  isAfterActiveCursor,
  loadCachedLegacyActiveRecords,
  mergeActiveItems,
} from "@/services/study/active-compatibility";
import {
  buildSourcePayload,
  mapSourceData,
  type Source,
  type SourceType,
} from "@/lib/material/sources";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function sourcesCollection(userId: string) {
  return collection(db, "users", userId, "sources");
}

const SOURCES_COLLECTION = "sources";

async function getLegacyActiveSources(userId: string) {
  const records = await loadCachedLegacyActiveRecords(
    userId,
    SOURCES_COLLECTION,
    async () => {
      const snapshot = await withTimeout(
        getDocs(sourcesCollection(userId)),
        LOAD_MS,
        "Load legacy sources"
      );
      return snapshot.docs
        .map((sourceDoc) => ({
          id: sourceDoc.id,
          data: sourceDoc.data() as Record<string, unknown>,
        }))
        .filter(
          ({ data }) => data.status !== "active" && data.status !== "archived"
        );
    }
  );
  return records.map(({ id, data }) => mapSourceData(id, data));
}

async function getLegacyActiveSourcesForFolder(
  userId: string,
  folderId: string
) {
  const records = await loadCachedLegacyActiveRecords(
    userId,
    `${SOURCES_COLLECTION}:folder:${folderId}`,
    async () => {
      const snapshot = await withTimeout(
        getDocs(
          query(
            sourcesCollection(userId),
            where("folderIds", "array-contains", folderId)
          )
        ),
        LOAD_MS,
        "Load legacy folder sources"
      );
      return snapshot.docs
        .map((sourceDoc) => ({
          id: sourceDoc.id,
          data: sourceDoc.data() as Record<string, unknown>,
        }))
        .filter(
          ({ data }) => data.status !== "active" && data.status !== "archived"
        );
    }
  );
  return records.map(({ id, data }) => mapSourceData(id, data));
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

/** Shared by the Progress, Cards and Topics pages. */
export async function getActiveSources(
  userId: string,
  options: CachedReadOptions = {}
): Promise<Source[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  return readThroughCache(
    { collection: "sources:active", userId: normalizedUserId },
    () => loadActiveSources(normalizedUserId),
    options
  );
}

async function loadActiveSources(normalizedUserId: string): Promise<Source[]> {
  const [snapshot, legacyItems] = await Promise.all([
    withTimeout(
      getDocs(
        query(
          sourcesCollection(normalizedUserId),
          where("status", "==", "active"),
          orderBy("updatedAt", "desc")
        )
      ),
      LOAD_MS,
      "Load active sources"
    ),
    getLegacyActiveSources(normalizedUserId),
  ]);

  const currentItems = snapshot.docs.map((sourceDoc) =>
    mapSourceData(sourceDoc.id, sourceDoc.data() as Record<string, unknown>)
  );
  return mergeActiveItems(currentItems, legacyItems);
}

export type SourceFolderPageCursor = {
  updatedAt: number;
  id: string;
};

export async function getActiveSourcesForFolderPage(
  userId: string,
  folderId: string,
  options: { cursor?: SourceFolderPageCursor | null; pageSize?: number } = {}
) {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedFolderId) throw new Error("Missing folderId.");
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 30));
  const constraints = [
    where("status", "==", "active"),
    where("folderIds", "array-contains", normalizedFolderId),
    orderBy("updatedAt", "desc"),
    orderBy(documentId(), "desc"),
    ...(options.cursor
      ? [startAfter(options.cursor.updatedAt, options.cursor.id)]
      : []),
    limit(pageSize + 1),
  ];
  const [snapshot, legacyItemsForFolder] = await Promise.all([
    withTimeout(
      getDocs(query(sourcesCollection(normalizedUserId), ...constraints)),
      LOAD_MS,
      "Load active folder source page"
    ),
    getLegacyActiveSourcesForFolder(normalizedUserId, normalizedFolderId),
  ]);

  const currentItems = snapshot.docs.map((sourceDoc) =>
    mapSourceData(sourceDoc.id, sourceDoc.data() as Record<string, unknown>)
  );
  const legacyItems = legacyItemsForFolder.filter((source) =>
      options.cursor ? isAfterActiveCursor(source, options.cursor) : true
    );
  const mergedItems = mergeActiveItems(currentItems, legacyItems);
  const items = mergedItems.slice(0, pageSize);
  const finalItem = items.at(-1);

  return {
    items,
    nextCursor:
      mergedItems.length > pageSize && finalItem
        ? { updatedAt: finalItem.updatedAt, id: finalItem.id }
        : null,
  };
}

export async function getActiveSourcesForDashboard(
  userId: string,
  sourceIds: readonly string[]
): Promise<Source[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  const uniqueIds = Array.from(
    new Set(sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean))
  ).slice(0, 4);
  const exactSnapshots = await Promise.all(
    uniqueIds.map((sourceId) =>
      withTimeout(
        getDoc(doc(sourcesCollection(normalizedUserId), sourceId)),
        LOAD_MS,
        "Load dashboard draft source"
      )
    )
  );
  const exactSources = exactSnapshots
    .filter((snapshot) => snapshot.exists())
    .map((snapshot) =>
      mapSourceData(
        snapshot.id,
        snapshot.data() as Record<string, unknown>
      )
    )
    .filter((source) => source.status === "active");
  if (exactSources.length > 0) return exactSources;

  const [existenceSnapshot, legacyItems] = await Promise.all([
    withTimeout(
      getDocs(
        query(
          sourcesCollection(normalizedUserId),
          where("status", "==", "active"),
          limit(1)
        )
      ),
      LOAD_MS,
      "Check for an active dashboard source"
    ),
    getLegacyActiveSources(normalizedUserId),
  ]);
  const currentItems = existenceSnapshot.docs.map((sourceDoc) =>
    mapSourceData(sourceDoc.id, sourceDoc.data() as Record<string, unknown>)
  );
  return mergeActiveItems(currentItems, legacyItems, 1);
}

export async function createSource(
  userId: string,
  input: {
    title: string;
    type: SourceType;
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
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, SOURCES_COLLECTION);
  void requestSourceIndex(docRef.id).catch(() => undefined);

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
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, SOURCES_COLLECTION);
  void requestSourceIndex(sourceId).catch(() => undefined);
}

export async function deleteSource(userId: string, sourceId: string) {
  await requestSourceIndex(sourceId, "DELETE").catch(() => undefined);
  await withTimeout(
    deleteDoc(doc(db, "users", userId, "sources", sourceId)),
    WRITE_MS,
    "Delete source"
  );
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, SOURCES_COLLECTION);
}
