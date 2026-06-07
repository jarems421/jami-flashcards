import type {
  Notebook,
  NotebookFile,
  NotebookPage,
} from "@/lib/workspace/notebooks";
import {
  assertImportedNotebookPageCount,
  buildUploadedNotebookPageMappings,
  getNotebookPdfPageCount,
} from "@/lib/workspace/notebook-pdf";
import {
  createNotebook,
  createNotebookPages,
  deleteNotebookFileRecord,
  deleteNotebookImportRecords,
  deleteNotebookPageRecords,
  deleteNotebookRecord,
  updateNotebook,
} from "@/services/study/notebooks";
import {
  deleteNotebookFile,
  uploadNotebookFile,
  validateNotebookUploadFile,
} from "@/services/study/notebook-files";

const IMPORTED_PAGE_COLOR = "white" as const;
const IMPORTED_PAGE_STYLE = "plain" as const;

function getImportStageMessage(stage: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return `${stage}: ${message}`;
}

export async function importUploadedNotebook(input: {
  userId: string;
  folderId: string;
  title: string;
  file: File;
  topicIds?: string[];
  color?: string;
  icon?: string;
  onProgress?: (progress: number) => void;
}) {
  validateNotebookUploadFile(input.file);
  const pageCount = await getNotebookPdfPageCount(input.file);
  let notebookId = "";
  let storagePath = "";

  try {
    let notebook;
    try {
      notebook = await createNotebook(input.userId, {
        folderId: input.folderId,
        title: input.title,
        type: "uploaded_file",
        topicIds: input.topicIds,
        color: input.color,
        icon: input.icon,
        pageColor: IMPORTED_PAGE_COLOR,
        pageStyle: IMPORTED_PAGE_STYLE,
      });
    } catch (error) {
      throw new Error(getImportStageMessage("Could not create the notebook", error));
    }
    notebookId = notebook.id;

    let file;
    try {
      file = await uploadNotebookFile({
        userId: input.userId,
        notebookId: notebook.id,
        folderId: input.folderId,
        file: input.file,
        pageCount,
        onProgress: input.onProgress,
      });
    } catch (error) {
      throw new Error(getImportStageMessage("Could not upload the PDF or image", error));
    }
    storagePath = file.storagePath;

    let pages;
    try {
      pages = await createNotebookPages(
        input.userId,
        buildUploadedNotebookPageMappings({
          pageCount,
          fileId: file.id,
          isPdf: input.file.type === "application/pdf",
        }).map((mapping) => ({
          notebookId: notebook.id,
          folderId: input.folderId,
          pageNumber: mapping.pageNumber,
          pageType: "past_paper_page" as const,
          title: mapping.title,
          pageColor: IMPORTED_PAGE_COLOR,
          pageStyle: IMPORTED_PAGE_STYLE,
          backgroundFileId: mapping.backgroundFileId,
          pdfPageIndex: mapping.pdfPageIndex,
        }))
      );
      assertImportedNotebookPageCount(pageCount, pages.length);
    } catch (error) {
      throw new Error(getImportStageMessage("Could not create the imported pages", error));
    }

    try {
      await updateNotebook(input.userId, notebook.id, {
        uploadedFileId: file.id,
      });
    } catch (error) {
      throw new Error(getImportStageMessage("Could not finish the notebook import", error));
    }

    return {
      notebook: { ...notebook, uploadedFileId: file.id },
      file,
      pages,
    };
  } catch (error) {
    if (notebookId) {
      try {
        await deleteNotebookImportRecords(input.userId, notebookId);
      } catch {
        try {
          await deleteNotebookRecord(input.userId, notebookId);
        } catch {
          // Best-effort rollback; preserve the original import error.
        }
      }
    }
    if (storagePath) {
      try {
        await deleteNotebookFile(storagePath);
      } catch {
        // Best-effort rollback; preserve the original import error.
      }
    }
    throw error;
  }
}

export async function appendUploadedFileToNotebook(input: {
  userId: string;
  notebook: Notebook;
  existingPageCount: number;
  file: File;
  onProgress?: (progress: number) => void;
}): Promise<{ file: NotebookFile; pages: NotebookPage[] }> {
  validateNotebookUploadFile(input.file);
  const pageCount = await getNotebookPdfPageCount(input.file);
  let uploadedFile: NotebookFile | null = null;
  let uploadedFileId = "";
  let uploadedStoragePath = "";
  let createdPages: NotebookPage[] = [];

  try {
    try {
      uploadedFile = await uploadNotebookFile({
        userId: input.userId,
        notebookId: input.notebook.id,
        folderId: input.notebook.folderId,
        file: input.file,
        pageCount,
        onProgress: input.onProgress,
      });
      uploadedFileId = uploadedFile.id;
      uploadedStoragePath = uploadedFile.storagePath;
    } catch (error) {
      throw new Error(getImportStageMessage("Could not upload the PDF or image", error));
    }

    try {
      createdPages = await createNotebookPages(
        input.userId,
        buildUploadedNotebookPageMappings({
          pageCount,
          fileId: uploadedFile.id,
          isPdf: input.file.type === "application/pdf",
        }).map((mapping) => ({
          notebookId: input.notebook.id,
          folderId: input.notebook.folderId,
          pageNumber: input.existingPageCount + mapping.pageNumber,
          pageType: "past_paper_page" as const,
          title: `Page ${input.existingPageCount + mapping.pageNumber}`,
          pageColor: IMPORTED_PAGE_COLOR,
          pageStyle: IMPORTED_PAGE_STYLE,
          backgroundFileId: mapping.backgroundFileId,
          pdfPageIndex: mapping.pdfPageIndex,
        }))
      );
      assertImportedNotebookPageCount(pageCount, createdPages.length);
    } catch (error) {
      throw new Error(getImportStageMessage("Could not create the imported pages", error));
    }

    if (!input.notebook.uploadedFileId) {
      try {
        await updateNotebook(input.userId, input.notebook.id, {
          uploadedFileId: uploadedFile.id,
        });
      } catch (error) {
        throw new Error(getImportStageMessage("Could not finish the notebook import", error));
      }
    }

    return { file: uploadedFile, pages: createdPages };
  } catch (error) {
    if (createdPages.length > 0) {
      try {
        await deleteNotebookPageRecords(
          input.userId,
          createdPages.map((page) => page.id)
        );
      } catch {
        // Best-effort rollback; preserve the original append error.
      }
    }
    if (uploadedFileId) {
      try {
        await deleteNotebookFileRecord(input.userId, uploadedFileId);
      } catch {
        // Best-effort rollback; preserve the original append error.
      }
    }
    if (uploadedStoragePath) {
      try {
        await deleteNotebookFile(uploadedStoragePath);
      } catch {
        // Best-effort rollback; preserve the original append error.
      }
    }
    throw error;
  }
}
