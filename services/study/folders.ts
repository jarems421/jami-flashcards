import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  buildStudyFolderPayload,
  mapStudyFolderData,
  normalizeStudyFolderName,
  type StudyFolder,
} from "@/lib/workspace/study-folders";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function foldersCollection(userId: string) {
  return collection(db, "users", userId, "studyFolders");
}

export async function getStudyFolders(userId: string): Promise<StudyFolder[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  const snapshot = await withTimeout(
    getDocs(query(foldersCollection(normalizedUserId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load study folders"
  );

  return snapshot.docs.map((folderDoc) =>
    mapStudyFolderData(folderDoc.id, folderDoc.data() as Record<string, unknown>)
  );
}

export async function getActiveStudyFolders(userId: string) {
  const folders = await getStudyFolders(userId);
  return folders.filter((folder) => !folder.archived);
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
    description?: string;
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

  return mapStudyFolderData(docRef.id, payload);
}

export async function updateStudyFolder(
  userId: string,
  folderId: string,
  input: Partial<{
    name: string;
    description: string;
    subject: string;
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
  if (input.description !== undefined) {
    updates.description = input.description.trim().slice(0, 400) || null;
  }
  if (input.subject !== undefined) {
    updates.subject = input.subject.trim().slice(0, 120) || null;
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
}

export async function archiveStudyFolder(userId: string, folderId: string) {
  await updateStudyFolder(userId, folderId, { archived: true });
}
