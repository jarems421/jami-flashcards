import {
  addDoc,
  collection,
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
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  readThroughCache,
  type CachedReadOptions,
} from "@/services/cache/read-through";
import {
  buildStudyFolderPayload,
  mapStudyFolderData,
  normalizeStudyFolderName,
  type StudyFolder,
} from "@/lib/workspace/study-folders";
import {
  normalizeStudyLevel,
  type StudyLevel,
} from "@/lib/profile/study-level";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function foldersCollection(userId: string) {
  return collection(db, "users", userId, "studyFolders");
}

export type StudyFolderPageCursor = {
  updatedAt: number;
  id: string;
};

export async function getActiveStudyFoldersPage(
  userId: string,
  options: { cursor?: StudyFolderPageCursor | null; pageSize?: number } = {}
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 30));
  const constraints = [
    where("archived", "==", false),
    orderBy("updatedAt", "desc"),
    orderBy(documentId(), "desc"),
    ...(options.cursor
      ? [startAfter(options.cursor.updatedAt, options.cursor.id)]
      : []),
    limit(pageSize + 1),
  ];
  const snapshot = await withTimeout(
    getDocs(query(foldersCollection(normalizedUserId), ...constraints)),
    LOAD_MS,
    "Load active study folder page"
  );
  const mergedItems = snapshot.docs.map((folderDoc) =>
    mapStudyFolderData(folderDoc.id, folderDoc.data() as Record<string, unknown>)
  );
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

/** Shared by the Cards, Decks and Library pages. */
export async function getActiveStudyFolders(
  userId: string,
  options: CachedReadOptions = {}
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  return readThroughCache(
    { collection: "folders:active", userId: normalizedUserId },
    () => loadActiveStudyFolders(normalizedUserId),
    options
  );
}

async function loadActiveStudyFolders(normalizedUserId: string) {
  const snapshot = await withTimeout(
    getDocs(
      query(
        foldersCollection(normalizedUserId),
        where("archived", "==", false),
        orderBy("updatedAt", "desc")
      )
    ),
    LOAD_MS,
    "Load active study folders"
  );

  return snapshot.docs.map((folderDoc) =>
    mapStudyFolderData(folderDoc.id, folderDoc.data() as Record<string, unknown>)
  );
}

export async function getStudyFolderById(
  userId: string,
  folderId: string
): Promise<StudyFolder | null> {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedFolderId) {
    throw new Error("Missing folderId.");
  }

  const snapshot = await withTimeout(
    getDoc(doc(db, "users", normalizedUserId, "studyFolders", normalizedFolderId)),
    LOAD_MS,
    "Load study folder"
  );

  if (!snapshot.exists()) {
    return null;
  }

  return mapStudyFolderData(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export async function createStudyFolder(
  userId: string,
  input: {
    name: string;
    subject?: string;
    color?: string;
    icon?: string;
    topicIds?: string[];
  }
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  const payload = buildStudyFolderPayload(input);
  const docRef = await withTimeout(
    addDoc(foldersCollection(normalizedUserId), payload),
    WRITE_MS,
    "Create study folder"
  );
  invalidateDashboardData(normalizedUserId);

  reportTutorialAction("create-folder", { folderId: docRef.id });

  return mapStudyFolderData(docRef.id, payload);
}

export async function updateStudyFolder(
  userId: string,
  folderId: string,
  input: Partial<{
    name: string;
    subject: string;
    studyLevel: StudyLevel | null;
    color: string;
    icon: string;
    topicIds: string[];
    archived: boolean;
  }>
) {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedFolderId) {
    throw new Error("Missing folderId.");
  }

  const updates: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (input.name !== undefined) {
    const name = normalizeStudyFolderName(input.name);
    if (!name) {
      throw new Error("Folder name is required.");
    }
    updates.name = name;
  }
  if (input.subject !== undefined) {
    updates.subject = input.subject.trim().slice(0, 120) || null;
  }
  if (input.studyLevel !== undefined) {
    updates.studyLevel = normalizeStudyLevel(input.studyLevel) ?? null;
  }
  if (input.color !== undefined) {
    updates.color = input.color.trim().slice(0, 80) || null;
  }
  if (input.icon !== undefined) {
    updates.icon = input.icon.trim().slice(0, 40) || null;
  }
  if (input.topicIds !== undefined) {
    updates.topicIds = input.topicIds;
  }
  if (typeof input.archived === "boolean") {
    updates.archived = input.archived;
  }

  await withTimeout(
    updateDoc(
      doc(db, "users", normalizedUserId, "studyFolders", normalizedFolderId),
      updates
    ),
    WRITE_MS,
    "Update study folder"
  );
  invalidateDashboardData(normalizedUserId);
}

export async function archiveStudyFolder(userId: string, folderId: string) {
  await updateStudyFolder(userId, folderId, { archived: true });
}
