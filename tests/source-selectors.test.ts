import { describe, expect, it } from "vitest";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Source } from "@/lib/material/sources";
import {
  filterSources,
  getPendingSourceDrafts,
  getSourceMadeCounts,
  resolveSelected,
  type SourceFilters,
} from "@/lib/material/source-selectors";

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "s-1",
    userId: "user-1",
    title: "Waves handout",
    type: "pasted_text",
    status: "active",
    topicIds: [],
    folderIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Source;
}

function draft(overrides: Partial<GeneratedContentDraft> = {}): GeneratedContentDraft {
  return {
    id: "d-1",
    kind: "flashcard",
    title: "Draft",
    topicIds: [],
    origin: "ai",
    contentStatus: "draft",
    sourceType: "source",
    sourceId: "s-1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as GeneratedContentDraft;
}

const ALL: SourceFilters = {
  search: "",
  folderId: "",
  type: "all",
  status: "all",
};

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("filterSources", () => {
  it("returns everything when nothing is filtered", () => {
    const sources = [source({ id: "a" }), source({ id: "b" })];
    expect(ids(filterSources(sources, ALL))).toEqual(["a", "b"]);
  });

  it("hides archived sources unless they are asked for", () => {
    const sources = [
      source({ id: "live", status: "active" }),
      source({ id: "old", status: "archived" }),
    ];
    expect(ids(filterSources(sources, { ...ALL, status: "active" }))).toEqual([
      "live",
    ]);
    expect(ids(filterSources(sources, { ...ALL, status: "archived" }))).toEqual([
      "old",
    ]);
  });

  it("filters by source type", () => {
    const sources = [
      source({ id: "text", type: "pasted_text" }),
      source({ id: "file", type: "file" }),
    ];
    expect(ids(filterSources(sources, { ...ALL, type: "file" }))).toEqual([
      "file",
    ]);
  });

  it("filters by folder membership", () => {
    const sources = [
      source({ id: "in", folderIds: ["f-1", "f-2"] }),
      source({ id: "out", folderIds: ["f-2"] }),
    ];
    expect(ids(filterSources(sources, { ...ALL, folderId: "f-1" }))).toEqual([
      "in",
    ]);
  });

  it("searches the title", () => {
    const sources = [source({ id: "a", title: "Waves" }), source({ id: "b", title: "Optics" })];
    expect(ids(filterSources(sources, { ...ALL, search: "wav" }))).toEqual(["a"]);
  });

  it("searches pasted text, links and filenames, not just the title", () => {
    // A student searches for whatever they remember, which is often the body.
    const sources = [
      source({ id: "text", title: "Untitled", contentText: "diffraction grating" }),
      source({ id: "link", title: "Untitled", externalUrl: "https://x.test/diffraction" }),
      source({ id: "file", title: "Untitled", fileName: "diffraction.pdf" }),
      source({ id: "other", title: "Untitled", contentText: "momentum" }),
    ];
    expect(ids(filterSources(sources, { ...ALL, search: "diffraction" }))).toEqual([
      "text",
      "link",
      "file",
    ]);
  });

  it("ignores case and surrounding spaces in the search", () => {
    const sources = [source({ id: "a", title: "Waves" })];
    expect(ids(filterSources(sources, { ...ALL, search: "  WAVES " }))).toEqual([
      "a",
    ]);
  });

  it("treats a whitespace-only search as no search", () => {
    const sources = [source({ id: "a" }), source({ id: "b" })];
    expect(filterSources(sources, { ...ALL, search: "   " })).toHaveLength(2);
  });

  it("applies every filter together", () => {
    const sources = [
      source({ id: "match", type: "file", status: "active", folderIds: ["f-1"], fileName: "waves.pdf" }),
      source({ id: "wrongType", type: "link", status: "active", folderIds: ["f-1"], title: "waves" }),
      source({ id: "wrongFolder", type: "file", status: "active", folderIds: ["f-9"], fileName: "waves.pdf" }),
    ];
    const filtered = filterSources(sources, {
      search: "waves",
      folderId: "f-1",
      type: "file",
      status: "active",
    });
    expect(ids(filtered)).toEqual(["match"]);
  });

  it("survives a source with no body fields at all", () => {
    const bare = source({ id: "bare", title: "Only a title" });
    expect(filterSources([bare], { ...ALL, search: "missing" })).toEqual([]);
    expect(ids(filterSources([bare], { ...ALL, search: "title" }))).toEqual([
      "bare",
    ]);
  });
});

describe("getPendingSourceDrafts", () => {
  const drafts = [
    draft({ id: "pending" }),
    draft({ id: "approved", contentStatus: "approved" }),
    draft({ id: "other-source", sourceId: "s-2" }),
    draft({ id: "not-a-source", sourceType: "card" }),
  ];

  it("keeps only unreviewed drafts belonging to the source", () => {
    expect(ids(getPendingSourceDrafts(drafts, "s-1"))).toEqual(["pending"]);
  });

  it("returns nothing when no source is selected", () => {
    // Without this guard every draft with an undefined sourceId would match.
    expect(getPendingSourceDrafts(drafts, null)).toEqual([]);
  });
});

describe("getSourceMadeCounts", () => {
  const drafts = [
    draft({ id: "card", contentStatus: "approved", kind: "flashcard" }),
    draft({ id: "q", contentStatus: "approved", kind: "practice-question" }),
    draft({ id: "q2", contentStatus: "approved", kind: "practice-question" }),
    draft({ id: "waiting", contentStatus: "draft", kind: "flashcard" }),
    draft({ id: "elsewhere", contentStatus: "approved", sourceId: "s-2" }),
  ];

  it("counts only what this source actually produced", () => {
    expect(getSourceMadeCounts(drafts, "s-1")).toEqual({
      flashcards: 1,
      questions: 2,
    });
  });

  it("reports zeroes rather than throwing with no source", () => {
    expect(getSourceMadeCounts(drafts, null)).toEqual({
      flashcards: 0,
      questions: 0,
    });
  });
});

describe("resolveSelected", () => {
  const items = [{ id: "a" }, { id: "b" }];

  it("returns the selected item when it is still present", () => {
    expect(resolveSelected(items, "b")).toEqual({ id: "b" });
  });

  it("falls back to the first item when the selection is gone", () => {
    // A filter change can drop the selection; an empty detail pane beside a
    // full list reads as breakage.
    expect(resolveSelected(items, "missing")).toEqual({ id: "a" });
  });

  it("falls back to the first item when nothing is selected", () => {
    expect(resolveSelected(items, null)).toEqual({ id: "a" });
  });

  it("returns null when there is nothing to select", () => {
    expect(resolveSelected([], "a")).toBeNull();
  });
});
