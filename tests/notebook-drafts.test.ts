import { describe, expect, it } from "vitest";
import {
  createNotebookPageDraft,
  getNotebookDraftDecision,
  parseNotebookPageDraft,
} from "@/lib/workspace/notebook-drafts";

function makeDraft() {
  return createNotebookPageDraft({
    userId: "alice",
    notebookId: "notebook-1",
    pageId: "page-1",
    baseContentRevision: 3,
    remoteUpdatedAt: 100,
    localRevision: 2,
    savedAt: 200,
    textBlocks: [
      {
        id: "text-1",
        x: 10,
        y: 20,
        width: 320,
        height: 120,
        text: "Recovered notes",
        outlineVisible: false,
      },
    ],
    inkSvg: "<svg></svg>",
    pageColor: "white",
    pageStyle: "lined",
    status: "working",
  });
}

describe("notebook local drafts", () => {
  it("round-trips a versioned recovery draft without clipping content", () => {
    const draft = makeDraft();
    expect(parseNotebookPageDraft(JSON.stringify(draft))).toEqual(draft);
  });

  /*
   * The most recent version wins, wherever it was made. There is no conflict
   * to ask about: one student, one device at a time.
   */
  it("restores the device copy only when it is newer than the synced page", () => {
    const draft = makeDraft(); // saved at 200
    expect(
      getNotebookDraftDecision(draft, {
        id: "page-1",
        notebookId: "notebook-1",
        updatedAt: 150,
      })
    ).toBe("restore");
    // Changed on another device after this copy was made: that change stands.
    expect(
      getNotebookDraftDecision(draft, {
        id: "page-1",
        notebookId: "notebook-1",
        updatedAt: 250,
      })
    ).toBe("discard");
  });

  it("discards corrupt or unrelated recovery records", () => {
    expect(parseNotebookPageDraft("not-json")).toBeNull();
    expect(parseNotebookPageDraft({ ...makeDraft(), inkSvg: "not svg" })).toBeNull();
    expect(
      getNotebookDraftDecision(makeDraft(), {
        id: "other-page",
        notebookId: "notebook-1",
        updatedAt: 150,
      })
    ).toBe("discard");
  });
});
