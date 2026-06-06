import type {
  Notebook,
  NotebookFile,
  NotebookPage,
  NotebookPageColor,
  NotebookPageStyle,
} from "@/lib/workspace/notebooks";
import {
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

export async function importUploadedNotebook(input: {
  userId: string;
  folderId: string;
  title: string;
  file: File;
  topicIds?: string[];
  color?: string;
  icon?: string;
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  onProgress?: (progress: number) => void;
}) {
  validateNotebookUploadFile(input.file);
  const pageCount = await getNotebookPdfPageCount(input.file);
  let notebookId = "";
  let storagePath = "";

  try {
    const notebook = await createNotebook(input.userId, {
      folderId: input.folderId,
      title: input.title,
      type: "blank",
      topicIds: input.topicIds,
      color: input.color,
      icon: input.icon,
      pageColor: input.pageColor,
      pageStyle: input.pageStyle,
    });
    notebookId = notebook.id;

    const file = await uploadNotebookFile({
      userId: input.userId,
      notebookId: notebook.id,
      folderId: input.folderId,
      file: input.file,
      pageCount,
      onProgress: input.onProgress,
    });
    storagePath = file.storagePath;

    const pages = await createNotebookPages(
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
        pageColor: input.pageColor,
        pageStyle: input.pageStyle,
        backgroundFileId: mapping.backgroundFileId,
        pdfPageIndex: mapping.pdfPageIndex,
      }))
    );

    await updateNotebook(input.userId, notebook.id, {
      uploadedFileId: file.id,
    });

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
  pageStyle: NotebookPageStyle;
  onProgress?: (progress: number) => void;
}): Promise<{ file: NotebookFile; pages: NotebookPage[] }> {
  validateNotebookUploadFile(input.file);
  const pageCount = await getNotebookPdfPageCount(input.file);
  let uploadedFile: NotebookFile | null = null;
  let createdPages: NotebookPage[] = [];

  try {
    uploadedFile = await uploadNotebookFile({
      userId: input.userId,
      notebookId: input.notebook.id,
      folderId: input.notebook.folderId,
      file: input.file,
      pageCount,
      onProgress: input.onProgress,
    });

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
        pageColor: input.notebook.pageColor,
        pageStyle: input.pageStyle,
        backgroundFileId: mapping.backgroundFileId,
        pdfPageIndex: mapping.pdfPageIndex,
      }))
    );

    if (!input.notebook.uploadedFileId) {
      await updateNotebook(input.userId, input.notebook.id, {
        uploadedFileId: uploadedFile.id,
      });
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
    if (uploadedFile) {
      try {
        await deleteNotebookFileRecord(input.userId, uploadedFile.id);
      } catch {
        // Best-effort rollback; preserve the original append error.
      }
      try {
        await deleteNotebookFile(uploadedFile.storagePath);
      } catch {
        // Best-effort rollback; preserve the original append error.
      }
    }
    throw error;
  }
}
