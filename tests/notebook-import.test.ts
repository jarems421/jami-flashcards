import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createNotebook: vi.fn(),
  createNotebookPages: vi.fn(),
  deleteNotebookFileRecord: vi.fn(),
  deleteNotebookImportRecords: vi.fn(),
  deleteNotebookPageRecords: vi.fn(),
  deleteNotebookRecord: vi.fn(),
  updateNotebook: vi.fn(),
  uploadNotebookFile: vi.fn(),
  deleteNotebookFile: vi.fn(),
  validateNotebookUploadFile: vi.fn(),
  getNotebookPdfPageCount: vi.fn(),
}));

vi.mock("@/services/study/notebooks", () => ({
  createNotebook: mocks.createNotebook,
  createNotebookPages: mocks.createNotebookPages,
  deleteNotebookFileRecord: mocks.deleteNotebookFileRecord,
  deleteNotebookImportRecords: mocks.deleteNotebookImportRecords,
  deleteNotebookPageRecords: mocks.deleteNotebookPageRecords,
  deleteNotebookRecord: mocks.deleteNotebookRecord,
  updateNotebook: mocks.updateNotebook,
}));

vi.mock("@/services/study/notebook-files", () => ({
  uploadNotebookFile: mocks.uploadNotebookFile,
  deleteNotebookFile: mocks.deleteNotebookFile,
  validateNotebookUploadFile: mocks.validateNotebookUploadFile,
}));

vi.mock("@/lib/workspace/notebook-pdf", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/workspace/notebook-pdf")>();
  return {
    ...original,
    getNotebookPdfPageCount: mocks.getNotebookPdfPageCount,
  };
});

import {
  appendUploadedFileToNotebook,
  importUploadedNotebook,
} from "@/services/study/notebook-import";

describe("uploaded notebook import", () => {
  const file = {
    name: "paper.pdf",
    type: "application/pdf",
    size: 1024,
  } as File;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNotebookPdfPageCount.mockResolvedValue(2);
    mocks.createNotebook.mockResolvedValue({
      id: "notebook-1",
      folderId: "folder-1",
      title: "Paper",
    });
    mocks.uploadNotebookFile.mockResolvedValue({
      id: "file-1",
      storagePath: "users/alice/notebookFiles/notebook-1/file-1-paper.pdf",
    });
    mocks.createNotebookPages.mockResolvedValue([
      { id: "page-1" },
      { id: "page-2" },
    ]);
    mocks.updateNotebook.mockResolvedValue(undefined);
    mocks.deleteNotebookImportRecords.mockResolvedValue(undefined);
    mocks.deleteNotebookFileRecord.mockResolvedValue(undefined);
    mocks.deleteNotebookPageRecords.mockResolvedValue(undefined);
    mocks.deleteNotebookFile.mockResolvedValue(undefined);
  });

  it("appends mapped file pages after an existing notebook's last page", async () => {
    const result = await appendUploadedFileToNotebook({
      userId: "alice",
      notebook: {
        id: "notebook-1",
        folderId: "folder-1",
        title: "Working",
        type: "blank",
        topicIds: [],
        sourceIds: [],
        color: "violet",
        icon: "none",
        pageColor: "white",
        pageStyle: "plain",
        archived: false,
        createdAt: 1,
        updatedAt: 1,
      },
      existingPageCount: 3,
      file,
    });

    expect(mocks.createNotebook).not.toHaveBeenCalled();
    expect(mocks.createNotebookPages).toHaveBeenCalledWith("alice", [
      expect.objectContaining({
        pageNumber: 4,
        title: "Page 4",
        pageColor: "white",
        pageStyle: "plain",
        backgroundFileId: "file-1",
        pdfPageIndex: 0,
      }),
      expect.objectContaining({
        pageNumber: 5,
        title: "Page 5",
        pageColor: "white",
        backgroundFileId: "file-1",
        pdfPageIndex: 1,
      }),
    ]);
    expect(result.pages).toHaveLength(2);
  });

  it("removes appended pages, metadata, and storage after a partial failure", async () => {
    mocks.createNotebookPages.mockResolvedValue([
      { id: "page-4" },
      { id: "page-5" },
    ]);
    mocks.updateNotebook.mockRejectedValue(new Error("notebook update failed"));

    await expect(
      appendUploadedFileToNotebook({
        userId: "alice",
        notebook: {
          id: "notebook-1",
          folderId: "folder-1",
          title: "Working",
          type: "blank",
          topicIds: [],
          sourceIds: [],
          color: "violet",
          icon: "none",
          pageColor: "white",
          pageStyle: "plain",
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          },
          existingPageCount: 3,
          file,
        })
    ).rejects.toThrow("notebook update failed");

    expect(mocks.deleteNotebookPageRecords).toHaveBeenCalledWith("alice", [
      "page-4",
      "page-5",
    ]);
    expect(mocks.deleteNotebookFileRecord).toHaveBeenCalledWith(
      "alice",
      "file-1"
    );
    expect(mocks.deleteNotebookFile).toHaveBeenCalledWith(
      "users/alice/notebookFiles/notebook-1/file-1-paper.pdf"
    );
  });

  it("creates one mapped notebook page per PDF page", async () => {
    const result = await importUploadedNotebook({
      userId: "alice",
      folderId: "folder-1",
      title: "Paper",
      file,
    });

    expect(mocks.createNotebook).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({
        type: "uploaded_file",
        pageColor: "white",
        pageStyle: "plain",
      })
    );
    expect(mocks.createNotebookPages).toHaveBeenCalledWith("alice", [
      expect.objectContaining({
        pageNumber: 1,
        pageColor: "white",
        pageStyle: "plain",
        backgroundFileId: "file-1",
        pdfPageIndex: 0,
      }),
      expect.objectContaining({
        pageNumber: 2,
        backgroundFileId: "file-1",
        pdfPageIndex: 1,
      }),
    ]);
    expect(result.pages).toHaveLength(2);
  });

  it("cleans up Firestore records and storage after a partial failure", async () => {
    mocks.createNotebookPages.mockRejectedValue(new Error("page write failed"));

    await expect(
      importUploadedNotebook({
        userId: "alice",
        folderId: "folder-1",
        title: "Paper",
        file,
      })
    ).rejects.toThrow("page write failed");

    expect(mocks.deleteNotebookImportRecords).toHaveBeenCalledWith(
      "alice",
      "notebook-1"
    );
    expect(mocks.deleteNotebookFile).toHaveBeenCalledWith(
      "users/alice/notebookFiles/notebook-1/file-1-paper.pdf"
    );
  });

  it("creates one white plain mapped page for an image import", async () => {
    const image = {
      name: "diagram.png",
      type: "image/png",
      size: 1024,
    } as File;
    mocks.getNotebookPdfPageCount.mockResolvedValue(1);
    mocks.createNotebookPages.mockResolvedValue([{ id: "page-1" }]);

    await importUploadedNotebook({
      userId: "alice",
      folderId: "folder-1",
      title: "Diagram",
      file: image,
    });

    expect(mocks.createNotebookPages).toHaveBeenCalledWith("alice", [
      expect.objectContaining({
        pageColor: "white",
        pageStyle: "plain",
        pdfPageIndex: undefined,
      }),
    ]);
  });

  it("identifies the failed import stage while preserving cleanup", async () => {
    mocks.uploadNotebookFile.mockRejectedValue(
      new Error("You do not have permission to upload this notebook file.")
    );

    await expect(
      importUploadedNotebook({
        userId: "alice",
        folderId: "folder-1",
        title: "Paper",
        file,
      })
    ).rejects.toThrow(
      "Could not upload the PDF or image: You do not have permission to upload this notebook file."
    );

    expect(mocks.deleteNotebookImportRecords).toHaveBeenCalledWith(
      "alice",
      "notebook-1"
    );
  });
});
