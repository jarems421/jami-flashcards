import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
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
  buildNotebookPagePayload,
  buildNotebookPayload,
  buildNotebookFilePayload,
  mapNotebookData,
  mapNotebookFileData,
  mapNotebookPageData,
  getNotebookPagesAfterDelete,
  normalizeNotebookInkData,
  normalizeNotebookStrokeData,
  normalizeNotebookTitle,
  normalizeNotebookPreviewSvg,
  prepareNotebookPageSnapshotForPersistence,
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
import {
  isNotebookInkRecordWithinLimits,
  mergeNotebookPageInk,
  splitNotebookPageForPersistence,
  type NotebookPageInkRecord,
} from "@/lib/workspace/notebook-page-ink-split";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;
/** Firestore caps a batch at 500 operations. */
const PAGE_DELETE_BATCH_LIMIT = 400;

export class NotebookPageConflictError extends Error {
  readonly code = "notebook-page-conflict";
  readonly remoteRevision: number;

  constructor(remoteRevision: number) {
    super(
      "This page changed on another device. Your work is safe in a local draft; reopen the notebook to choose which version to keep."
    );
    this.name = "NotebookPageConflictError";
    this.remoteRevision = remoteRevision;
  }
}

function notebooksCollection(userId: string) {
  return collection(db, "users", userId, "notebooks");
}

function notebookPagesCollection(userId: string) {
  return collection(db, "users", userId, "notebookPages");
}

function notebookFilesCollection(userId: string) {
  return collection(db, "users", userId, "notebookFiles");
}

function notebookPageInkRef(userId: string, pageId: string) {
  return doc(db, "users", userId, "notebookPageInk", pageId);
}

const NOTEBOOKS_COLLECTION = "notebooks";

async function getLegacyActiveNotebooks(userId: string) {
  const records = await loadCachedLegacyActiveRecords(
    userId,
    NOTEBOOKS_COLLECTION,
    async () => {
      const snapshot = await withTimeout(
        getDocs(notebooksCollection(userId)),
        LOAD_MS,
        "Load legacy notebooks"
      );
      return snapshot.docs
        .map((notebookDoc) => ({
          id: notebookDoc.id,
          data: notebookDoc.data() as Record<string, unknown>,
        }))
        .filter(({ data }) => typeof data.archived !== "boolean");
    }
  );
  return records.map(({ id, data }) => mapNotebookData(id, data));
}

async function getLegacyActiveNotebooksForFolder(
  userId: string,
  folderId: string
) {
  const records = await loadCachedLegacyActiveRecords(
    userId,
    `${NOTEBOOKS_COLLECTION}:folder:${folderId}`,
    async () => {
      const snapshot = await withTimeout(
        getDocs(
          query(
            notebooksCollection(userId),
            where("folderId", "==", folderId)
          )
        ),
        LOAD_MS,
        "Load legacy folder notebooks"
      );
      return snapshot.docs
        .map((notebookDoc) => ({
          id: notebookDoc.id,
          data: notebookDoc.data() as Record<string, unknown>,
        }))
        .filter(({ data }) => typeof data.archived !== "boolean");
    }
  );
  return records.map(({ id, data }) => mapNotebookData(id, data));
}

/** Shared by the Progress, Topics and Library pages. */
export async function getActiveNotebooks(
  userId: string,
  options: CachedReadOptions = {}
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }

  return readThroughCache(
    { collection: "notebooks:active", userId: normalizedUserId },
    () => loadActiveNotebooks(normalizedUserId),
    options
  );
}

async function loadActiveNotebooks(normalizedUserId: string) {
  const [snapshot, legacyItems] = await Promise.all([
    withTimeout(
      getDocs(
        query(
          notebooksCollection(normalizedUserId),
          where("archived", "==", false),
          orderBy("updatedAt", "desc")
        )
      ),
      LOAD_MS,
      "Load active notebooks"
    ),
    getLegacyActiveNotebooks(normalizedUserId),
  ]);

  const currentItems = snapshot.docs.map((notebookDoc) =>
    mapNotebookData(notebookDoc.id, notebookDoc.data() as Record<string, unknown>)
  );
  return mergeActiveItems(currentItems, legacyItems);
}

export async function getRecentActiveNotebooks(
  userId: string,
  maximum = 3
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  const safeMaximum = Math.max(1, Math.min(20, Math.floor(maximum)));
  const [snapshot, legacyItems] = await Promise.all([
    withTimeout(
      getDocs(
        query(
          notebooksCollection(normalizedUserId),
          where("archived", "==", false),
          orderBy("updatedAt", "desc"),
          limit(safeMaximum)
        )
      ),
      LOAD_MS,
      "Load recent active notebooks"
    ),
    getLegacyActiveNotebooks(normalizedUserId),
  ]);

  const currentItems = snapshot.docs.map((notebookDoc) =>
    mapNotebookData(notebookDoc.id, notebookDoc.data() as Record<string, unknown>)
  );
  return mergeActiveItems(currentItems, legacyItems, safeMaximum);
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

export type NotebookFolderPageCursor = {
  updatedAt: number;
  id: string;
};

export async function getNotebooksForFolderPage(
  userId: string,
  folderId: string,
  options: { cursor?: NotebookFolderPageCursor | null; pageSize?: number } = {}
) {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId.");
  }
  if (!normalizedFolderId) {
    throw new Error("Missing folderId.");
  }

  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 30));
  const constraints = [
    where("folderId", "==", normalizedFolderId),
    where("archived", "==", false),
    orderBy("updatedAt", "desc"),
    orderBy(documentId(), "desc"),
    ...(options.cursor
      ? [startAfter(options.cursor.updatedAt, options.cursor.id)]
      : []),
    limit(pageSize + 1),
  ];
  const [snapshot, legacyItemsForFolder] = await Promise.all([
    withTimeout(
      getDocs(
        query(notebooksCollection(normalizedUserId), ...constraints)
      ),
      LOAD_MS,
      "Load folder notebook page"
    ),
    getLegacyActiveNotebooksForFolder(normalizedUserId, normalizedFolderId),
  ]);

  const currentItems = snapshot.docs.map((notebookDoc) =>
    mapNotebookData(notebookDoc.id, notebookDoc.data() as Record<string, unknown>)
  );
  const legacyItems = legacyItemsForFolder.filter((notebook) =>
      options.cursor
        ? isAfterActiveCursor(notebook, options.cursor)
        : true
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
  invalidateDashboardData(normalizedUserId);
  invalidateLegacyActiveRecords(normalizedUserId, NOTEBOOKS_COLLECTION);

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
    pastPaperId: string;
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
  if (input.pastPaperId !== undefined) {
    updates.pastPaperId = input.pastPaperId.trim().slice(0, 160) || null;
  }
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
  invalidateDashboardData(normalizedUserId);
  invalidateLegacyActiveRecords(normalizedUserId, NOTEBOOKS_COLLECTION);
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

/**
 * Fetches one page's full-fidelity ink.
 *
 * Returns null both when a page has no ink and when it still stores its ink
 * inline, since a legacy page's inline copy is the authoritative one and no
 * ink record exists for it.
 */
export async function getNotebookPageInk(
  userId: string,
  pageId: string
): Promise<NotebookPageInkRecord | null> {
  const normalizedUserId = userId.trim();
  const normalizedPageId = pageId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedPageId) throw new Error("Missing pageId.");

  const snapshot = await withTimeout(
    getDoc(notebookPageInkRef(normalizedUserId, normalizedPageId)),
    LOAD_MS,
    "Load notebook page ink"
  );
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as Record<string, unknown>;
  return {
    pageId: normalizedPageId,
    notebookId: typeof data.notebookId === "string" ? data.notebookId : "",
    inkData: normalizeNotebookInkData(data.inkData),
    strokeData: normalizeNotebookStrokeData(data.strokeData),
    contentRevision:
      typeof data.contentRevision === "number" &&
      Number.isFinite(data.contentRevision)
        ? Math.max(0, Math.round(data.contentRevision))
        : 0,
    updatedAt:
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : 0,
  };
}

/**
 * Loads a page ready to edit, pulling its ink record only when the page does
 * not already carry ink inline.
 */
export async function getNotebookPageWithInk(
  userId: string,
  page: NotebookPage
): Promise<NotebookPage> {
  if (page.inkData || page.strokeData) return page;
  return mergeNotebookPageInk(page, await getNotebookPageInk(userId, page.id));
}

export async function getNextNotebookPageNumber(
  userId: string,
  notebookId: string
) {
  const normalizedUserId = userId.trim();
  const normalizedNotebookId = notebookId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!normalizedNotebookId) throw new Error("Missing notebookId.");

  const snapshot = await withTimeout(
    getDocs(
      query(
        notebookPagesCollection(normalizedUserId),
        where("notebookId", "==", normalizedNotebookId),
        orderBy("pageNumber", "desc"),
        limit(1)
      )
    ),
    LOAD_MS,
    "Load final notebook page"
  );
  const finalPage = snapshot.docs[0];
  if (!finalPage) return 1;
  return (
    mapNotebookPageData(
      finalPage.id,
      finalPage.data() as Record<string, unknown>
    ).pageNumber + 1
  );
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
  invalidateDashboardData(normalizedUserId);

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
    questionPrompt?: string;
    questionAssets?: import("@/lib/practice/practice-papers").PracticePaperQuestionAsset[];
    linkedQuestionId?: string;
    linkedSourceId?: string;
    linkedPastPaperId?: string;
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
  invalidateDashboardData(normalizedUserId);
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
    pageColor: NotebookPageColor;
    pageStyle: NotebookPageStyle;
    status: NotebookPageStatus;
    questionPrompt: string;
    questionAssets: import("@/lib/practice/practice-papers").PracticePaperQuestionAsset[];
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

  const changesPageContent =
    input.typedContent !== undefined ||
    input.textBlocks !== undefined ||
    input.inkData !== undefined ||
    input.strokeData !== undefined ||
    input.pageColor !== undefined ||
    input.pageStyle !== undefined ||
    input.status !== undefined;
  if (
    input.typedContent !== undefined ||
    input.textBlocks !== undefined ||
    input.inkData !== undefined
  ) {
    prepareNotebookPageSnapshotForPersistence({
      typedContent: input.typedContent ?? "",
      textBlocks: input.textBlocks ?? [],
      inkData: input.inkData ?? undefined,
      pageColor: input.pageColor ?? "white",
      pageStyle: input.pageStyle ?? "plain",
      status: input.status ?? "blank",
    });
  }

  if (input.title !== undefined) updates.title = input.title.trim().slice(0, 120) || null;
  if (input.pageType !== undefined) updates.pageType = input.pageType;
  if (input.typedContent !== undefined) updates.typedContent = input.typedContent.trim() || null;
  if (input.textBlocks !== undefined) updates.textBlocks = input.textBlocks;
  if (input.inkData !== undefined) updates.inkData = input.inkData;
  if (input.strokeData !== undefined) updates.strokeData = input.strokeData;
  if (input.pageColor !== undefined) updates.pageColor = input.pageColor;
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
  if (changesPageContent) updates.contentRevision = increment(1);

  await withTimeout(
    updateDoc(doc(db, "users", normalizedUserId, "notebookPages", normalizedPageId), updates),
    WRITE_MS,
    "Update notebook page"
  );
  invalidateDashboardData(normalizedUserId);
}

export async function saveNotebookPageSnapshot(
  userId: string,
  input: {
    notebookId: string;
    pageId: string;
    typedContent: string;
    textBlocks: NotebookTextBlock[];
    inkData: NotebookInkData;
    pageColor: NotebookPageColor;
    pageStyle: NotebookPageStyle;
    status: NotebookPageStatus;
    baseContentRevision: number;
  }
) {
  const normalizedUserId = userId.trim();
  const notebookId = input.notebookId.trim();
  const pageId = input.pageId.trim();
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (!notebookId) throw new Error("Missing notebookId.");
  if (!pageId) throw new Error("Missing pageId.");

  const snapshot = prepareNotebookPageSnapshotForPersistence(input);
  const inkData = snapshot.inkData;
  if (!inkData) throw new Error("This page has no drawing snapshot to save.");
  const baseContentRevision =
    Number.isFinite(input.baseContentRevision) && input.baseContentRevision >= 0
      ? Math.round(input.baseContentRevision)
      : 0;
  const pageRef = doc(db, "users", normalizedUserId, "notebookPages", pageId);
  const notebookRef = doc(db, "users", normalizedUserId, "notebooks", notebookId);

  const result = await withTimeout(
    runTransaction(db, async (transaction) => {
      const pageDocument = await transaction.get(pageRef);
      if (!pageDocument.exists()) throw new Error("This notebook page no longer exists.");
      const pageData = pageDocument.data() as Record<string, unknown>;
      if (pageData.notebookId !== notebookId) {
        throw new Error("This page does not belong to the open notebook.");
      }
      const remoteRevision =
        typeof pageData.contentRevision === "number" &&
        Number.isFinite(pageData.contentRevision) &&
        pageData.contentRevision >= 0
          ? Math.round(pageData.contentRevision)
          : 0;
      if (remoteRevision !== baseContentRevision) {
        throw new NotebookPageConflictError(remoteRevision);
      }

      const now = Date.now();
      const contentRevision = remoteRevision + 1;
      const { thumbnail, ink } = splitNotebookPageForPersistence({
        pageId,
        notebookId,
        inkData,
        contentRevision,
        updatedAt: now,
      });
      if (ink && !isNotebookInkRecordWithinLimits(ink)) {
        throw new Error("This page has too much ink to sync safely.");
      }

      // Page and ink move together. A page record claiming a revision whose
      // ink never landed would open as blank work, so the two writes must
      // succeed or fail as one.
      transaction.update(pageRef, {
        typedContent: snapshot.typedContent.trim() || null,
        textBlocks: snapshot.textBlocks,
        // Ink now lives in its own record. Clearing the inline copy is what
        // converts a legacy page, and it happens only once the ink write below
        // is part of the same committed transaction.
        inkData: null,
        strokeData: null,
        thumbnail,
        pageColor: snapshot.pageColor,
        pageStyle: snapshot.pageStyle,
        status: snapshot.status,
        contentRevision,
        updatedAt: now,
      });
      if (ink) {
        transaction.set(notebookPageInkRef(normalizedUserId, pageId), ink);
      } else {
        transaction.delete(notebookPageInkRef(normalizedUserId, pageId));
      }
      transaction.update(notebookRef, {
        previewInkSvg: normalizeNotebookPreviewSvg(input.inkData.svg) ?? null,
        previewPageId: pageId,
        updatedAt: now,
      });
      return { contentRevision, updatedAt: now };
    }),
    WRITE_MS,
    "Save notebook page"
  );
  invalidateDashboardData(normalizedUserId);
  invalidateLegacyActiveRecords(normalizedUserId, NOTEBOOKS_COLLECTION);
  return result;
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
  // Deleting the page without its ink record would orphan the ink, which no
  // later read could reach or clean up.
  batch.delete(notebookPageInkRef(normalizedUserId, normalizedPageId));
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
  invalidateDashboardData(normalizedUserId);
  invalidateLegacyActiveRecords(normalizedUserId, NOTEBOOKS_COLLECTION);

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
  invalidateDashboardData(normalizedUserId);

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
  invalidateDashboardData(normalizedUserId);
  invalidateLegacyActiveRecords(normalizedUserId, NOTEBOOKS_COLLECTION);
}

export async function deleteNotebookRecord(userId: string, notebookId: string) {
  await withTimeout(
    deleteDoc(doc(db, "users", userId, "notebooks", notebookId)),
    WRITE_MS,
    "Delete notebook"
  );
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, NOTEBOOKS_COLLECTION);
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
  invalidateDashboardData(normalizedUserId);
}

export async function deleteNotebookPageRecords(
  userId: string,
  pageIds: string[]
) {
  const normalizedUserId = userId.trim();
  const normalizedPageIds = pageIds.map((id) => id.trim()).filter(Boolean);
  if (!normalizedUserId) throw new Error("Missing userId.");
  if (normalizedPageIds.length === 0) return;

  // Each page costs two deletes now that ink is a separate record, and a batch
  // is capped at 500 operations, so chunk rather than assuming a notebook is
  // small enough to fit.
  const pagesPerBatch = Math.floor(PAGE_DELETE_BATCH_LIMIT / 2);
  for (let start = 0; start < normalizedPageIds.length; start += pagesPerBatch) {
    const batch = writeBatch(db);
    for (const pageId of normalizedPageIds.slice(start, start + pagesPerBatch)) {
      batch.delete(doc(db, "users", normalizedUserId, "notebookPages", pageId));
      batch.delete(notebookPageInkRef(normalizedUserId, pageId));
    }
    await withTimeout(batch.commit(), WRITE_MS, "Clean up notebook pages");
  }
  invalidateDashboardData(normalizedUserId);
}
