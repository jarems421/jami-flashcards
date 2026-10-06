import { describe, expect, it } from "vitest";
import type { Source } from "@/lib/material/sources";
import type { NotebookFile } from "@/lib/workspace/notebooks";
import {
  addNotebookSheet,
  EMPTY_NOTEBOOK_SHEETS,
  MAX_NOTEBOOK_SHEETS,
  notebookSheetFromAttachment,
  notebookSheetsFromNotebookFiles,
  notebookSheetsFromSources,
  parseStoredNotebookSheets,
  removeNotebookSheet,
  replaceNotebookSheet,
  setNotebookSheetPage,
  type NotebookSheet,
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
    const sheet: NotebookSheet = { storagePath: "users/u1/sourceFiles/s1/ms.pdf", title: "Mark scheme", fileType: "application/pdf", origin: "folder" };
    const other: NotebookSheet = { ...sheet, storagePath: "users/u1/sourceFiles/s2/qp.pdf", title: "Question paper" };
    expect(parseStoredNotebookSheets({ sheets: [{ slot: 2, sheet }, { slot: 0, sheet: other }], open: false })).toEqual({
      sheets: [{ slot: 2, sheet }, { slot: 0, sheet: other }],
      open: false,
    });
    // One kept before there could be several.
    expect(parseStoredNotebookSheets({ sheet })).toEqual({ sheets: [{ slot: 0, sheet }], open: true });
    expect(
      parseStoredNotebookSheets({
        sheets: [
          { slot: 0, sheet: { ...sheet, fileType: "text/html" } },
          { slot: 1, sheet: { ...sheet, storagePath: "https://example.com/x.pdf" } },
          { slot: 7, sheet },
          { slot: 1, sheet },
          { slot: 2, sheet },
        ],
      }).sheets
    ).toEqual([{ slot: 1, sheet }]);
    expect(parseStoredNotebookSheets("nonsense")).toEqual(EMPTY_NOTEBOOK_SHEETS);
  });
});

describe("several sheets beside the page", () => {
  const sheet = (name: string): NotebookSheet => ({
    storagePath: `users/u1/sourceFiles/${name}/${name}.pdf`,
    title: name,
    fileType: "application/pdf",
    origin: "folder",
  });

  it("opens each new sheet in its own panel, up to three", () => {
    let state = EMPTY_NOTEBOOK_SHEETS;
    const slots: number[] = [];
    for (const name of ["questions", "mark-scheme", "formulae"]) {
      const result = addNotebookSheet(state, sheet(name));
      expect(result.added).toBe(true);
      slots.push(result.slot);
      state = result.next;
    }
    expect(slots).toEqual([0, 1, 2]);
    expect(state.open).toBe(true);
    expect(state.sheets).toHaveLength(MAX_NOTEBOOK_SHEETS);
  });

  it("never opens the same sheet twice, and shows them again when asked for one already kept", () => {
    const first = addNotebookSheet(EMPTY_NOTEBOOK_SHEETS, sheet("questions")).next;
    const again = addNotebookSheet({ ...first, open: false }, sheet("questions"));
    expect(again).toEqual({ next: { ...first, open: true }, slot: 0, added: false });
  });

  it("lets the oldest make way once three are open, in the panel it was in", () => {
    let state = EMPTY_NOTEBOOK_SHEETS;
    for (const name of ["a", "b", "c"]) state = addNotebookSheet(state, sheet(name)).next;
    const result = addNotebookSheet(state, sheet("d"));
    expect(result.slot).toBe(0);
    expect(result.added).toBe(false);
    expect(result.next.sheets.map((kept) => kept.sheet.title)).toEqual(["b", "c", "d"]);
  });

  it("changes one panel's sheet, or closes that panel if the sheet is already open elsewhere", () => {
    let state = EMPTY_NOTEBOOK_SHEETS;
    for (const name of ["a", "b"]) state = addNotebookSheet(state, sheet(name)).next;
    expect(replaceNotebookSheet(state, 0, sheet("c")).sheets.map((kept) => [kept.slot, kept.sheet.title])).toEqual([
      [0, "c"],
      [1, "b"],
    ]);
    expect(replaceNotebookSheet(state, 0, sheet("b")).sheets.map((kept) => kept.sheet.title)).toEqual(["b"]);
  });

  it("remembers the page a PDF was left on, and starts a swapped-in file at its first page", () => {
    let state = EMPTY_NOTEBOOK_SHEETS;
    for (const name of ["a", "b"]) state = addNotebookSheet(state, sheet(name)).next;
    state = setNotebookSheetPage(state, 1, 4);
    expect(state.sheets.map((kept) => kept.page ?? 0)).toEqual([0, 4]);
    const reread = parseStoredNotebookSheets(JSON.parse(JSON.stringify(state)));
    expect(reread.sheets[1]?.page).toBe(4);
    expect(replaceNotebookSheet(state, 1, sheet("c")).sheets[1]?.page).toBeUndefined();
    expect(setNotebookSheetPage(state, 1, 0).sheets[1]).toEqual({ slot: 1, sheet: sheet("b") });
  });

  it("closes one sheet and frees its panel for the next", () => {
    let state = EMPTY_NOTEBOOK_SHEETS;
    for (const name of ["a", "b", "c"]) state = addNotebookSheet(state, sheet(name)).next;
    state = removeNotebookSheet(state, 1);
    expect(state.sheets.map((kept) => kept.slot)).toEqual([0, 2]);
    expect(addNotebookSheet(state, sheet("d")).slot).toBe(1);
    expect(removeNotebookSheet(removeNotebookSheet(state, 0), 2)).toEqual(EMPTY_NOTEBOOK_SHEETS);
  });
});
