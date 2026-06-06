import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  buildNotebookPagePayload,
  buildNotebookPayload,
  buildNotebookFilePayload,
  mapNotebookData,
  mapNotebookFileData,
  mapNotebookPageData,
  getNotebookPagesAfterDelete,
  normalizeNotebookTitle,
  normalizeNotebookPreviewSvg,
  type Notebook,
  type NotebookFile,
  type NotebookInkData,
  type NotebookPageColor,
  type NotebookPageStyle,
  type NotebookPageStatus,
  type NotebookPage,
  type NotebookPageType,
  type NotebookStrokeData,
  type NotebookTextBlock,
  type NotebookType,
} from "@/lib/workspace/notebooks";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function notebooksCollection(userId: string) {
  return collection(db, "users", userId, "notebooks");
}

function notebookPagesCollection(userId: string) {
  return collection(db, "users", userId, "notebookPages");
}

function notebookFilesCollection(userId: string) {
  return collection(db, "users", userId, "notebookFiles");
}

export async function getNotebooks(userId: string): Promise<Notebook[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  const snapshot = await withTimeout(
    getDocs(query(notebooksCollection(normalizedUserId), orderBy("updatedAt", "desc"))),
    LOAD_MS,
    "Load notebooks"
  );

  return snapshot.docs.map((notebookDoc) =>
    mapNotebookData(notebookDoc.id, notebookDoc.data() as Record<string, unknown>)
  );
}

export async function getActiveNotebooks(userId: string) {
  const notebooks = await getNotebooks(userId);
  return notebooks.filter((notebook) => !notebook.archived);
}

export async function getNotebookById(
  userId: string,
  notebookId: string
): Promise<Notebook | null> {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedNotebookId) {
    throw new Error("Missing notebookId.");
  }

  const snapshot = await withTimeout(
    getDoc(doc(db, "users", normalizedUserId, "notebooks", normalizedNotebookId)),
    LOAD_MS,
    "Load notebook"
  );

  if (!snapshot.exists()) {
    return null;
  }

  return mapNotebookData(snapshot.id, snapshot.data() as Record<string, unknown>);
}

export async function getNotebooksForFolder(userId: string, folderId: string) {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedFolderId) {
    throw new Error("Missing folderId.");
  }

  const snapshot = await withTimeout(
    getDocs(
      query(
        notebooksCollection(normalizedUserId),
        where("folderId", "==", normalizedFolderId)
      )
    ),
    LOAD_MS,
    "Load folder notebooks"
  );

  return snapshot.docs
    .map((notebookDoc) =>
      mapNotebookData(notebookDoc.id, notebookDoc.data() as Record<string, unknown>)
    )
    .filter((notebook) => !notebook.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createNotebook(
  userId: string,
  input: {
    folderId: string;
    title: string;
    type?: NotebookType;
    topicIds?: string[];
    sourceIds?: string[];
    practiceSetId?: string;
    pastPaperId?: string;
    color?: string;
    icon?: string;
    pageColor?: NotebookPageColor;
    pageStyle?: NotebookPageStyle;
    uploadedFileId?: string;
    previewInkSvg?: string;
    previewPageId?: string;
  }
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  const payload = buildNotebookPayload(input);
  const docRef = await withTimeout(
    addDoc(notebooksCollection(normalizedUserId), payload),
    WRITE_MS,
    "Create notebook"
  );

  return mapNotebookData(docRef.id, payload);
}

export async function updateNotebook(
  userId: string,
  notebookId: string,
  input: Partial<{
    title: string;
    type: NotebookType;
    topicIds: string[];
    sourceIds: string[];
    color: string;
    icon: string;
    pageStyle: NotebookPageStyle;
    uploadedFileId: string;
    previewInkSvg: string;
    previewPageId: string;
    archived: boolean;
  }>
) {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedNotebookId) {
    throw new Error("Missing notebookId.");
  }

  const updates: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (input.title !== undefined) {
    const title = normalizeNotebookTitle(input.title);
    if (!title) {
      throw new Error("Notebook title is required.");
    }
    updates.title = title;
  }
  if (input.type !== undefined) updates.type = input.type;
  if (input.topicIds !== undefined) updates.topicIds = input.topicIds;
  if (input.sourceIds !== undefined) updates.sourceIds = input.sourceIds;
  if (input.color !== undefined) updates.color = input.color.trim().slice(0, 80) || null;
  if (input.icon !== undefined) updates.icon = input.icon.trim().slice(0, 40) || null;
  if (input.pageStyle !== undefined) updates.pageStyle = input.pageStyle;
  if (input.uploadedFileId !== undefined) {
    updates.uploadedFileId = input.uploadedFileId.trim().slice(0, 160) || null;
  }
  if (input.previewInkSvg !== undefined) {
    updates.previewInkSvg = normalizeNotebookPreviewSvg(input.previewInkSvg) ?? null;
  }
  if (input.previewPageId !== undefined) {
    updates.previewPageId = input.previewPageId.trim().slice(0, 160) || null;
  }
  if (typeof input.archived === "boolean") updates.archived = input.archived;

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "notebooks", normalizedNotebookId), updates),
    WRITE_MS,
    "Update notebook"
  );
}

export async function getNotebookPages(
  userId: string,
  notebookId: string
): Promise<NotebookPage[]> {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedNotebookId) {
    throw new Error("Missing notebookId.");
  }

  const snapshot = await withTimeout(
    getDocs(
      query(
        notebookPagesCollection(normalizedUserId),
        where("notebookId", "==", normalizedNotebookId)
      )
    ),
    LOAD_MS,
    "Load notebook pages"
  );

  return snapshot.docs
    .map((pageDoc) =>
      mapNotebookPageData(pageDoc.id, pageDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function createNotebookPage(
  userId: string,
  input: {
    notebookId: string;
    folderId: string;
    pageNumber: number;
    title?: string;
    pageType?: NotebookPageType;
    typedContent?: string;
    textBlocks?: NotebookTextBlock[];
    inkData?: NotebookInkData;
    strokeData?: NotebookStrokeData;
    pageColor?: NotebookPageColor;
    pageStyle?: NotebookPageStyle;
    status?: NotebookPageStatus;
    questionPrompt?: string;
    linkedQuestionId?: string;
    linkedSourceId?: string;
    linkedPastPaperId?: string;
    backgroundFileId?: string;
    pdfPageIndex?: number;
  }
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  const payload = buildNotebookPagePayload(input);
  const docRef = await withTimeout(
    addDoc(notebookPagesCollection(normalizedUserId), payload),
    WRITE_MS,
    "Create notebook page"
  );

  return mapNotebookPageData(docRef.id, payload);
}

export async function createNotebookPages(
  userId: string,
  inputs: Array<{
    notebookId: string;
    folderId: string;
    pageNumber: number;
    title?: string;
    pageType?: NotebookPageType;
    pageColor?: NotebookPageColor;
    pageStyle?: NotebookPageStyle;
    status?: NotebookPageStatus;
    backgroundFileId?: string;
    pdfPageIndex?: number;
  }>
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (inputs.length === 0) throw new Error("Add at least one notebook page.");
  if (inputs.length > 200) throw new Error("A PDF notebook can contain up to 200 pages.");

  const batch = writeBatch(db);
  const entries = inputs.map((input) => {
    const pageRef = doc(notebookPagesCollection(normalizedUserId));
    const payload = buildNotebookPagePayload(input);
    batch.set(pageRef, payload);
    return { id: pageRef.id, payload };
  });
  await withTimeout(batch.commit(), WRITE_MS, "Create notebook pages");
  return entries.map(({ id, payload }) => mapNotebookPageData(id, payload));
}

export async function updateNotebookPage(
  userId: string,
  pageId: string,
  input: Partial<{
    title: string;
    pageType: NotebookPageType;
    typedContent: string;
    textBlocks: NotebookTextBlock[];
    inkData: NotebookInkData | null;
    strokeData: NotebookStrokeData | null;
    pageStyle: NotebookPageStyle;
    status: NotebookPageStatus;
    questionPrompt: string;
    linkedQuestionId: string;
    linkedSourceId: string;
    linkedPastPaperId: string;
    backgroundFileId: string;
    pdfPageIndex: number;
  }>
) {
  const normalizedUserId = userId.trim();
  const normalizedPageId = pageId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedPageId) {
    throw new Error("Missing pageId.");
  }

  const updates: Record<string, unknown> = {
    updatedAt: Date.now(),
  };

  if (input.title !== undefined) updates.title = input.title.trim().slice(0, 120) || null;
  if (input.pageType !== undefined) updates.pageType = input.pageType;
  if (input.typedContent !== undefined) updates.typedContent = input.typedContent.trim().slice(0, 30_000) || null;
  if (input.textBlocks !== undefined) updates.textBlocks = input.textBlocks;
  if (input.inkData !== undefined) updates.inkData = input.inkData;
  if (input.strokeData !== undefined) updates.strokeData = input.strokeData;
  if (input.pageStyle !== undefined) updates.pageStyle = input.pageStyle;
  if (input.status !== undefined) updates.status = input.status;
  if (input.questionPrompt !== undefined) updates.questionPrompt = input.questionPrompt.trim().slice(0, 4_000) || null;
  if (input.linkedQuestionId !== undefined) updates.linkedQuestionId = input.linkedQuestionId.trim().slice(0, 160) || null;
  if (input.linkedSourceId !== undefined) updates.linkedSourceId = input.linkedSourceId.trim().slice(0, 160) || null;
  if (input.linkedPastPaperId !== undefined) updates.linkedPastPaperId = input.linkedPastPaperId.trim().slice(0, 160) || null;
  if (input.backgroundFileId !== undefined) {
    updates.backgroundFileId = input.backgroundFileId.trim().slice(0, 160) || null;
  }
  if (input.pdfPageIndex !== undefined) {
    updates.pdfPageIndex =
      Number.isFinite(input.pdfPageIndex) && input.pdfPageIndex >= 0
        ? Math.round(input.pdfPageIndex)
        : null;
  }

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "notebookPages", normalizedPageId), updates),
    WRITE_MS,
    "Update notebook page"
  );
}

export async function saveNotebookPageSnapshot(
  userId: string,
  input: {
    notebookId: string;
    pageId: string;
    typedContent: string;
    textBlocks: NotebookTextBlock[];
    inkData: NotebookInkData;
    pageStyle: NotebookPageStyle;
    status: NotebookPageStatus;
  }
) {
  const normalizedUserId = userId.trim();
  const notebookId = input.notebookId.trim();
  const pageId = input.pageId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!notebookId) throw new Error("Missing notebookId.");
  if (!pageId) throw new Error("Missing pageId.");

  const now = Date.now();
  const previewInkSvg = normalizeNotebookPreviewSvg(input.inkData.svg);
  const batch = writeBatch(db);
  batch.update(
    doc(db, "users", normalizedUserId, "notebookPages", pageId),
    {
      typedContent: input.typedContent.trim().slice(0, 30_000) || null,
      textBlocks: input.textBlocks,
      inkData: input.inkData,
      strokeData: null,
      pageStyle: input.pageStyle,
      status: input.status,
      updatedAt: now,
    }
  );
  batch.update(
    doc(db, "users", normalizedUserId, "notebooks", notebookId),
    {
      previewInkSvg: previewInkSvg ?? null,
      previewPageId: pageId,
      updatedAt: now,
    }
  );
  await withTimeout(batch.commit(), WRITE_MS, "Save notebook page");
}

export async function deleteNotebookPage(
  userId: string,
  notebookId: string,
  pageId: string
): Promise<NotebookPage[]> {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  const normalizedPageId = pageId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedNotebookId) {
    throw new Error("Missing notebookId.");
  }
  if (!normalizedPageId) {
    throw new Error("Missing pageId.");
  }

  const pages = await getNotebookPages(normalizedUserId, normalizedNotebookId);
  const pageToDelete = pages.find((page) => page.id === normalizedPageId);
  if (!pageToDelete) {
    throw new Error("Page not found.");
  }
  if (pages.length <= 1) {
    throw new Error("A notebook needs at least one page.");
  }

  const nextPages = getNotebookPagesAfterDelete(pages, normalizedPageId);
  const now = Date.now();
  const batch = writeBatch(db);

  batch.delete(doc(db, "users", normalizedUserId, "notebookPages", normalizedPageId));
  for (const page of nextPages) {
    const previous = pages.find((candidate) => candidate.id === page.id);
    if (!previous) continue;
    const updates: Record<string, unknown> = { updatedAt: now };
    if (previous.pageNumber !== page.pageNumber) updates.pageNumber = page.pageNumber;
    if (previous.title !== page.title) updates.title = page.title ?? null;
    batch.update(doc(db, "users", normalizedUserId, "notebookPages", page.id), updates);
  }
  batch.update(doc(db, "users", normalizedUserId, "notebooks", normalizedNotebookId), {
    updatedAt: now,
  });

  await withTimeout(batch.commit(), WRITE_MS, "Delete notebook page");

  return nextPages.map((page) => ({ ...page, updatedAt: now }));
}

export async function getNotebookFiles(
  userId: string,
  notebookId: string
): Promise<NotebookFile[]> {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedNotebookId) throw new Error("Missing notebookId.");

  const snapshot = await withTimeout(
    getDocs(
      query(
        notebookFilesCollection(normalizedUserId),
        where("notebookId", "==", normalizedNotebookId)
      )
    ),
    LOAD_MS,
    "Load notebook files"
  );

  return snapshot.docs
    .map((fileDoc) =>
      mapNotebookFileData(fileDoc.id, fileDoc.data() as Record<string, unknown>)
    )
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export async function createNotebookFileMetadata(
  userId: string,
  input: {
    notebookId: string;
    folderId: string;
    fileName: string;
    fileType: string;
    storagePath: string;
    sizeBytes?: number;
    pageCount?: number;
  }
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");

  const payload = buildNotebookFilePayload(input);
  const docRef = await withTimeout(
    addDoc(notebookFilesCollection(normalizedUserId), payload),
    WRITE_MS,
    "Create notebook file metadata"
  );

  return mapNotebookFileData(docRef.id, payload);
}

export async function deleteNotebookImportRecords(
  userId: string,
  notebookId: string
) {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedNotebookId) throw new Error("Missing notebookId.");

  const [pagesSnapshot, filesSnapshot] = await Promise.all([
    getDocs(
      query(
        notebookPagesCollection(normalizedUserId),
        where("notebookId", "==", normalizedNotebookId)
      )
    ),
    getDocs(
      query(
        notebookFilesCollection(normalizedUserId),
        where("notebookId", "==", normalizedNotebookId)
      )
    ),
  ]);
  const batch = writeBatch(db);
  pagesSnapshot.docs.forEach((pageDoc) => batch.delete(pageDoc.ref));
  filesSnapshot.docs.forEach((fileDoc) => batch.delete(fileDoc.ref));
  batch.delete(
    doc(db, "users", normalizedUserId, "notebooks", normalizedNotebookId)
  );
  await withTimeout(batch.commit(), WRITE_MS, "Clean up notebook import");
}

export async function deleteNotebookRecord(userId: string, notebookId: string) {
  await withTimeout(
    deleteDoc(doc(db, "users", userId, "notebooks", notebookId)),
    WRITE_MS,
    "Delete notebook"
  );
}

export async function deleteNotebookFileRecord(userId: string, fileId: string) {
  const normalizedUserId = userId.trim();
  const normalizedFileId = fileId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedFileId) throw new Error("Missing fileId.");

  await withTimeout(
    deleteDoc(doc(db, "users", normalizedUserId, "notebookFiles", normalizedFileId)),
    WRITE_MS,
    "Delete notebook file metadata"
  );
}

export async function deleteNotebookPageRecords(
  userId: string,
  pageIds: string[]
) {
  const normalizedUserId = userId.trim();
  const normalizedPageIds = pageIds.map((id) => id.trim()).filter(Boolean);
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (normalizedPageIds.length === 0) return;

  const batch = writeBatch(db);
  normalizedPageIds.forEach((pageId) => {
    batch.delete(doc(db, "users", normalizedUserId, "notebookPages", pageId));
  });
  await withTimeout(batch.commit(), WRITE_MS, "Clean up notebook pages");
}
