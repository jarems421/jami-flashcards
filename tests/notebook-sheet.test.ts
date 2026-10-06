import { describe, expect, it } from "vitest";
import type { Source } from "@/lib/material/sources";
import type { NotebookFile } from "@/lib/workspace/notebooks";
import {
  notebookSheetFromAttachment,
  notebookSheetsFromNotebookFiles,
  notebookSheetsFromSources,
  parseStoredNotebookSheet,
} from "@/lib/workspace/notebook-sheet";

function notebookFile(overrides: Partial<NotebookFile>): NotebookFile {
  return {
    id: "f1",
    notebookId: "n1",
    folderId: "folder",
    fileName: "Question sheet.pdf",
    fileType: "application/pdf",
    storagePath: "users/u1/notebookFiles/n1/f1/Question sheet.pdf",
    uploadedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function source(overrides: Partial<Source>): Source {
  return {
    id: "s1",
    title: "Mark scheme",
    type: "file",
    folderIds: ["folder"],
    topicIds: [],
    fileName: "ms.pdf",
    fileType: "application/pdf",
    storagePath: "users/u1/sourceFiles/s1/ms.pdf",
    status: "active",
    createdBy: "u1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("sheets kept beside a notebook page", () => {
  it("offers the notebook's imported PDFs and pictures, titled without the extension", () => {
    expect(
      notebookSheetsFromNotebookFiles([
        notebookFile({}),
        notebookFile({ id: "f2", fileName: "diagram.png", fileType: "image/png", storagePath: "users/u1/notebookFiles/n1/f2/diagram.png" }),
        notebookFile({ id: "f3", storagePath: "" }),
      ])
    ).toEqual([
      { storagePath: "users/u1/notebookFiles/n1/f1/Question sheet.pdf", title: "Question sheet", fileType: "application/pdf", origin: "notebook" },
      { storagePath: "users/u1/notebookFiles/n1/f2/diagram.png", title: "diagram", fileType: "image/png", origin: "notebook" },
    ]);
  });

  it("offers only the folder's uploaded PDFs and pictures", () => {
    const sheets = notebookSheetsFromSources([
      source({}),
      source({ id: "s2", type: "pasted_text", storagePath: undefined }),
      source({ id: "s3", fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      source({ id: "s4", status: "archived" }),
    ]);
    expect(sheets.map((sheet) => sheet.title)).toEqual(["Mark scheme"]);
    expect(sheets[0]?.origin).toBe("folder");
  });

  it("keeps a PDF or picture sent to Jami, not a Word file", () => {
    expect(
      notebookSheetFromAttachment({
        storagePath: "users/u1/sourceFiles/chat-1/sheet.pdf",
        fileName: "sheet.pdf",
        fileType: "application/pdf",
        sizeBytes: 10,
      })
    ).toMatchObject({ title: "sheet", origin: "chat" });
    expect(
      notebookSheetFromAttachment({
        storagePath: "users/u1/sourceFiles/chat-2/notes.txt",
        fileName: "notes.txt",
        fileType: "text/plain",
        sizeBytes: 10,
      })
    ).toBeNull();
  });

  it("reads back what the device remembered and drops anything malformed", () => {
    const sheet = { storagePath: "users/u1/sourceFiles/s1/ms.pdf", title: "Mark scheme", fileType: "application/pdf", origin: "folder" };
    expect(parseStoredNotebookSheet({ sheet, open: false })).toEqual({ sheet, open: false });
    expect(parseStoredNotebookSheet({ sheet })).toEqual({ sheet, open: true });
    expect(parseStoredNotebookSheet({ sheet: { ...sheet, fileType: "text/html" } })).toBeNull();
    expect(parseStoredNotebookSheet({ sheet: { ...sheet, storagePath: "https://example.com/x.pdf" } })).toBeNull();
    expect(parseStoredNotebookSheet("nonsense")).toBeNull();
  });
});
