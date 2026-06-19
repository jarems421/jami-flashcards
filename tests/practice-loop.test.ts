import { afterEach, describe, expect, it, vi } from "vitest";
import { isFeatureEnabled } from "@/lib/app/feature-flags";
import { getDeckHref, getDeckStudyHref, getDeckStudyRouteHref } from "@/lib/app/routes";
import { mapCardData } from "@/lib/study/cards";
import { getMasteryScoreDelta } from "@/lib/practice/mastery";
import { buildTopicProgress } from "@/lib/practice/progress";
import { mapTopicData, slugifyTopicName } from "@/lib/practice/topics";
import {
  buildFlashcardDraftCardData,
  buildPracticeQuestionDraftNotebookPageData,
} from "@/lib/practice/generated-content";
import { buildSourcePayload, mapSourceData } from "@/lib/practice/sources";
import {
  buildStudyFolderPayload,
  mapStudyFolderData,
} from "@/lib/workspace/study-folders";
import { addFolderId, normalizeFolderIds, removeFolderId } from "@/lib/workspace/folder-links";
import { getFolderNameValidationError } from "@/lib/workspace/folder-form";
import {
  getObjectColorPreset,
  normalizeObjectColor,
  normalizeObjectIcon,
} from "@/components/workspace/object-card-styles";
import {
  DEFAULT_DECK_COLOR_PRESET,
  DEFAULT_DECK_ICON_PRESET,
  normalizeDeckColorPreset,
  normalizeDeckIconPreset,
} from "@/lib/study/deck-style";
import {
  buildTypedContentFromTextBlocks,
  buildNotebookFilePayload,
  buildNotebookPagePayload,
  buildNotebookPayload,
  getNotebookPagesAfterDelete,
  mapNotebookData,
  mapNotebookFileData,
  mapNotebookPageData,
  resizeNotebookTextBlockFromEdge,
} from "@/lib/workspace/notebooks";
import { buildNotebookStoragePath } from "@/services/study/notebook-files";

describe("Jami notebook-first learning foundations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps topics distinct from flexible card tags", () => {
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "user-1",
      front: "What does chlorophyll do?",
      back: "It absorbs light energy.",
      tags: ["exam", "week-5"],
      topicIds: ["topic-photosynthesis"],
      createdAt: 1,
    });

    expect(card.tags).toEqual(["exam", "week-5"]);
    expect(card.topicIds).toEqual(["topic-photosynthesis"]);
  });

  it("keeps folders and notebooks enabled while flashcard AI stays scoped down", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_PRACTISE", "true");

    expect(isFeatureEnabled("enablePractise")).toBe(true);
    expect(isFeatureEnabled("enableLibrary")).toBe(true);
    expect(isFeatureEnabled("enableFolders")).toBe(true);
    expect(isFeatureEnabled("enableNotebooks")).toBe(true);
    expect(isFeatureEnabled("enableFlashcardAi")).toBe(false);
  });

  it("routes folder deck objects to study while preserving deck detail access", () => {
    expect(getDeckStudyRouteHref("deck-history")).toBe("/dashboard/decks/deck-history/study");
    expect(getDeckStudyHref("deck-history")).toBe("/dashboard/study?mode=custom&decks=deck-history");
    expect(getDeckHref("deck-history")).toBe("/dashboard/decks/deck-history");
  });

  it("validates folder creation from the name field only", () => {
    expect(getFolderNameValidationError("")).toBe("Folder name is required.");
    expect(getFolderNameValidationError("   ")).toBe("Folder name is required.");
    expect(getFolderNameValidationError("Biology")).toBeNull();
  });

  it("normalizes topic data without depending on question-bank models", () => {
    expect(slugifyTopicName("  Cold War Causes! ")).toBe("cold-war-causes");

    const topic = mapTopicData("topic-1", {
      name: "  Cold War causes  ",
      subject: " History ",
      aliases: ["post-war tension"],
      status: "active",
      createdBy: "user",
      createdAt: 1,
      updatedAt: 2,
    });

    expect(topic.slug).toBe("cold-war-causes");
    expect(topic.subject).toBe("History");
    expect(getMasteryScoreDelta("negative")).toBe(-2);
  });

  it("builds progress from cards, folders, notebooks, sources, and mastery events", () => {
    const topic = mapTopicData("topic-1", {
      name: "Photosynthesis",
      subject: "Biology",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "user-1",
      front: "What does chlorophyll do?",
      back: "Absorbs light energy.",
      topicIds: ["topic-1"],
      tags: ["exam"],
      createdAt: 1,
      dueDate: 1,
      difficulty: 8,
      reps: 2,
    });
    const source = mapSourceData("source-1", {
      title: "Plant notes",
      type: "pasted_text",
      topicIds: ["topic-1"],
      contentText: "Photosynthesis notes.",
      status: "active",
      createdBy: "user-1",
      createdAt: 1,
      updatedAt: 1,
    });
    const notebook = mapNotebookData("notebook-1", {
      folderId: "folder-1",
      title: "Photosynthesis working",
      type: "general_working",
      topicIds: ["topic-1"],
      sourceIds: ["source-1"],
      archived: false,
      createdAt: 1,
      updatedAt: 2,
    });
    const folder = mapStudyFolderData("folder-1", {
      name: "Science",
      subject: "Biology",
      topicIds: ["topic-1"],
      archived: false,
      createdAt: 1,
      updatedAt: 2,
    });

    const summary = buildTopicProgress({
      topics: [topic],
      cards: [card],
      sources: [source],
      notebooks: [notebook],
      studyFolders: [folder],
      masteryEvents: [
        {
          id: "event-1",
          topicId: "topic-1",
          sourceType: "manual",
          weight: "negative",
          scoreDelta: -2,
          reason: "Notebook page marked needs review",
          algorithmVersion: "test",
          createdAt: 2,
        },
      ],
      now: 10,
    });

    expect(summary[0]).toMatchObject({
      cardCount: 1,
      weakCardCount: 1,
      dueCardCount: 1,
      notebookCount: 1,
      sourceCount: 1,
      folderCount: 1,
      masteryScore: -2,
    });
  });

  it("turns an approved flashcard draft into card data without losing provenance", () => {
    const card = buildFlashcardDraftCardData(
      {
        id: "draft-1",
        kind: "flashcard",
        title: "Chlorophyll",
        front: " What does chlorophyll do? ",
        back: " It absorbs light energy. ",
        topicIds: ["topic-photosynthesis"],
        origin: "source-derived",
        contentStatus: "draft",
        sourceType: "source",
        sourceId: "source-plant-notes",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        userId: "user-1",
        deckId: "deck-1",
        now: 10,
      }
    );

    expect(card).toMatchObject({
      deckId: "deck-1",
      userId: "user-1",
      front: "What does chlorophyll do?",
      back: "It absorbs light energy.",
      tags: [],
      topicIds: ["topic-photosynthesis"],
      sourceIds: ["source-plant-notes"],
      createdAt: 10,
    });
  });

  it("approves source practice drafts into notebook page data instead of questions", () => {
    const page = buildPracticeQuestionDraftNotebookPageData({
      id: "draft-question-1",
      kind: "practice-question",
      title: "Cold War cause",
      questionText: "Explain one reason the Cold War became tense after 1945.",
      answerText: "Ideological conflict made both sides suspicious.",
      solutionText: "Name the cause, then explain how it increased mistrust.",
      topicIds: ["topic-cold-war"],
      origin: "source-derived",
      contentStatus: "draft",
      sourceType: "source",
      sourceId: "source-history-note",
      createdAt: 1,
      updatedAt: 1,
    });

    expect(page).toMatchObject({
      title: "Cold War cause",
      pageType: "question",
      questionPrompt: "Explain one reason the Cold War became tense after 1945.",
      linkedSourceId: "source-history-note",
      status: "blank",
    });
    expect(page.typedContent).toContain("Expected answer:");
    expect(page.typedContent).toContain("Solution notes:");
  });

  it("rejects unsafe generated draft conversions", () => {
    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "practice-question",
          front: "Front",
          back: "Back",
          topicIds: [],
          contentStatus: "draft",
        },
        { userId: "user-1", deckId: "deck-1" }
      )
    ).toThrow("Only flashcard drafts");

    expect(() =>
      buildPracticeQuestionDraftNotebookPageData({
        kind: "practice-question",
        questionText: "",
        topicIds: [],
        contentStatus: "draft",
      })
    ).toThrow("question text");
  });

  it("validates and maps saved Library sources", () => {
    const payload = buildSourcePayload("user-1", {
      title: " Class notes ",
      type: "pasted_text",
      subject: " Biology ",
      folderIds: ["folder-science"],
      topicIds: ["topic-photosynthesis"],
      contentText: " Plants use light energy to make glucose. ",
      now: 10,
    });
    const source = mapSourceData("source-1", payload);

    expect(source).toMatchObject({
      id: "source-1",
      title: "Class notes",
      type: "pasted_text",
      subject: "Biology",
      folderIds: ["folder-science"],
      topicIds: ["topic-photosynthesis"],
      contentText: "Plants use light energy to make glucose.",
      status: "active",
      createdBy: "user-1",
    });
  });

  it("validates broad study folders separately from topics", () => {
    const payload = buildStudyFolderPayload({
      name: "  Humanities  ",
      subject: " History ",
      topicIds: ["topic-cold-war", "topic-cold-war"],
      now: 40,
    });
    const folder = mapStudyFolderData("folder-1", payload);

    expect(folder).toMatchObject({
      id: "folder-1",
      name: "Humanities",
      subject: "History",
      topicIds: ["topic-cold-war"],
      archived: false,
    });
    expect(() => buildStudyFolderPayload({ name: "" })).toThrow("Folder name is required");
  });

  it("keeps folder and notebook object visuals configurable but bounded", () => {
    expect(normalizeObjectColor("emerald")).toBe("emerald");
    expect(normalizeObjectColor("unknown")).toBe("sky");
    expect(normalizeObjectIcon("none")).toBe("none");
    expect(normalizeObjectIcon("notebook")).toBe("notebook");
    expect(normalizeObjectIcon("file")).toBe("none");
    expect(normalizeObjectIcon("globe")).toBe("none");
    expect(normalizeObjectIcon("code")).toBe("code");
    expect(normalizeObjectIcon("calculator")).toBe("calculator");
    expect(normalizeObjectIcon("brain")).toBe("brain");
    expect(normalizeObjectIcon("language")).toBe("language");
    expect(normalizeObjectIcon("history")).toBe("history");
    expect(normalizeObjectIcon("art")).toBe("art");
    expect(normalizeObjectIcon("music")).toBe("music");
    expect(normalizeObjectIcon("heart")).toBe("heart");
    expect(normalizeObjectIcon("random-icon")).toBe("none");
    expect(getObjectColorPreset("rose")).toMatchObject({
      id: "rose",
      label: "Rose",
    });
  });

  it("uses the shared object defaults for deck customisation", () => {
    expect(DEFAULT_DECK_COLOR_PRESET).toBe("sky");
    expect(DEFAULT_DECK_ICON_PRESET).toBe("none");
    expect(normalizeDeckColorPreset("violet")).toBe("violet");
    expect(normalizeDeckIconPreset("notebook")).toBe("notebook");
    expect(normalizeDeckIconPreset("cap")).toBe("none");
    expect(normalizeDeckIconPreset("flask")).toBe("none");
  });

  it("adds and removes folder links without duplicating or deleting assets", () => {
    expect(normalizeFolderIds([" folder-a ", "folder-a", "", "folder-b"])).toEqual([
      "folder-a",
      "folder-b",
    ]);
    expect(addFolderId(["folder-a"], "folder-b")).toEqual(["folder-a", "folder-b"]);
    expect(addFolderId(["folder-a"], "folder-a")).toEqual(["folder-a"]);
    expect(removeFolderId(["folder-a", "folder-b"], "folder-a")).toEqual(["folder-b"]);
  });

  it("validates notebook pages as the active working surface", () => {
    const notebookPayload = buildNotebookPayload({
      folderId: "folder-science",
      title: "  Photosynthesis practice  ",
      type: "blank",
      topicIds: ["topic-photosynthesis"],
      sourceIds: ["source-class-notes"],
      pageColor: "black",
      pageStyle: "grid",
      now: 50,
    });
    const notebook = mapNotebookData("notebook-1", notebookPayload);
    const pagePayload = buildNotebookPagePayload({
      notebookId: notebook.id,
      folderId: notebook.folderId,
      pageNumber: 1,
      pageType: "question",
      questionPrompt: "Explain why chlorophyll matters.",
      typedContent: "It absorbs light energy.",
      strokeData: {
        version: 1,
        strokes: [{ points: [{ x: 1, y: 2 }], color: "white", width: 5, tool: "pen" }],
      },
      pageColor: "black",
      pageStyle: "grid",
      status: "working",
      linkedSourceId: "source-class-notes",
      now: 60,
    });
    const page = mapNotebookPageData("page-1", pagePayload);

    expect(notebook).toMatchObject({
      id: "notebook-1",
      folderId: "folder-science",
      title: "Photosynthesis practice",
      type: "blank",
      topicIds: ["topic-photosynthesis"],
      sourceIds: ["source-class-notes"],
      pageColor: "black",
      pageStyle: "grid",
    });
    expect(page).toMatchObject({
      id: "page-1",
      notebookId: "notebook-1",
      folderId: "folder-science",
      pageNumber: 1,
      pageType: "question",
      pageColor: "black",
      pageStyle: "grid",
      status: "working",
      questionPrompt: "Explain why chlorophyll matters.",
      typedContent: "It absorbs light energy.",
      linkedSourceId: "source-class-notes",
    });
    expect(page.strokeData?.strokes[0]).toMatchObject({
      color: "white",
      width: 5,
      tool: "pen",
    });
  });

  it("validates notebook page styles and highlighter strokes", () => {
    const payload = buildNotebookPagePayload({
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      pageStyle: "dot",
      strokeData: {
        version: 1,
        strokes: [
          {
            points: [{ x: 12, y: 20, pressure: 0.72, time: 42 }],
            color: "yellow",
            width: 18,
            tool: "highlighter",
          },
          {
            points: [{ x: 22, y: 28, pressure: 4 }],
            color: "#3B82F6",
            width: 120,
            tool: "pen",
          },
          {
            points: [{ x: 32, y: 38 }],
            color: "not-a-colour" as unknown as "black",
            width: 5,
            tool: "pen",
          },
        ],
      },
    });
    const page = mapNotebookPageData("page-style", payload);

    expect(page.pageStyle).toBe("dot");
    expect(page.strokeData?.strokes[0]).toMatchObject({
      color: "yellow",
      width: 18,
      tool: "highlighter",
    });
    expect(page.strokeData?.strokes[1].color).toBe("#3b82f6");
    expect(page.strokeData?.strokes[2].color).toBe("black");
    expect(page.strokeData?.strokes[0].points[0].pressure).toBe(0.72);
    expect(page.strokeData?.strokes[0].points[0].time).toBe(42);
    expect(page.strokeData?.strokes[1].points[0].pressure).toBe(1);
    expect(page.strokeData?.strokes[1].width).toBe(96);
    expect(page.strokeData?.strokes[2].points[0].pressure).toBe(0.5);
    expect(page.strokeData?.strokes[2].points[0].time).toBe(0);

    expect(
      mapNotebookPageData("page-legacy-style", {
        notebookId: "notebook-1",
        folderId: "folder-1",
        pageNumber: 1,
        pageStyle: "fancy",
      }).pageStyle
    ).toBe("plain");
  });

  it("maps legacy typed content into a default notebook text block", () => {
    const page = mapNotebookPageData("page-legacy", {
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      pageType: "free_working",
      typedContent: "Legacy typed notes",
      pageColor: "white",
      status: "working",
      createdAt: 1,
      updatedAt: 1,
    });

    expect(page.textBlocks).toEqual([
      expect.objectContaining({
        id: "legacy-typed-content",
        text: "Legacy typed notes",
        x: 80,
        y: 92,
      }),
    ]);
  });

  it("saves floating text blocks with a plain typed-content fallback", () => {
    const payload = buildNotebookPagePayload({
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      textBlocks: [
        { id: "block-1", x: 10, y: 20, width: 240, height: 80, text: "First idea" },
        { id: "block-2", x: 80, y: 140, width: 300, height: 90, text: "Second idea" },
      ],
    });
    const page = mapNotebookPageData("page-1", payload);

    expect(payload.typedContent).toBe("First idea\n\nSecond idea");
    expect(page.textBlocks).toHaveLength(2);
    expect(buildTypedContentFromTextBlocks(page.textBlocks)).toBe("First idea\n\nSecond idea");
  });

  it("clamps invalid floating text block dimensions into the notebook page", () => {
    const page = mapNotebookPageData("page-1", {
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      textBlocks: [
        { id: "block-1", x: -100, y: 9999, width: 20, height: 9999, text: "Clamped" },
      ],
    });

    expect(page.textBlocks[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 120,
      height: 1240,
      text: "Clamped",
    });
  });

  it("resizes text blocks from each edge while anchoring the opposite side", () => {
    const block = {
      id: "block-1",
      x: 100,
      y: 120,
      width: 300,
      height: 160,
      text: "Resize me",
    };

    expect(
      resizeNotebookTextBlockFromEdge({ block, edge: "left", deltaX: 40, deltaY: 0 })
    ).toMatchObject({ x: 140, width: 260 });
    expect(
      resizeNotebookTextBlockFromEdge({ block, edge: "right", deltaX: 60, deltaY: 0 })
    ).toMatchObject({ x: 100, width: 360 });
    expect(
      resizeNotebookTextBlockFromEdge({ block, edge: "top", deltaX: 0, deltaY: 30 })
    ).toMatchObject({ y: 150, height: 130 });
    expect(
      resizeNotebookTextBlockFromEdge({ block, edge: "bottom", deltaX: 0, deltaY: 50 })
    ).toMatchObject({ y: 120, height: 210 });
    expect(
      resizeNotebookTextBlockFromEdge({ block, edge: "left", deltaX: 999, deltaY: 0 })
    ).toMatchObject({ x: 280, width: 120 });
  });

  it("falls legacy grey notebook page colour back to white", () => {
    const page = mapNotebookPageData("page-grey", {
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      pageColor: "grey",
    });

    expect(page.pageColor).toBe("white");
  });

  it("renumbers notebook pages after deleting one page", () => {
    const pages = [
      mapNotebookPageData("page-1", {
        notebookId: "notebook-1",
        folderId: "folder-1",
        pageNumber: 1,
        title: "Page 1",
      }),
      mapNotebookPageData("page-2", {
        notebookId: "notebook-1",
        folderId: "folder-1",
        pageNumber: 2,
        title: "Custom proof",
      }),
      mapNotebookPageData("page-3", {
        notebookId: "notebook-1",
        folderId: "folder-1",
        pageNumber: 3,
        title: "Page 3",
      }),
    ];

    const nextPages = getNotebookPagesAfterDelete(pages, "page-1");

    expect(nextPages.map((page) => [page.id, page.pageNumber, page.title])).toEqual([
      ["page-2", 1, "Custom proof"],
      ["page-3", 2, "Page 2"],
    ]);
  });

  it("validates notebook file metadata for uploaded-file notebooks without parsing the file", () => {
    const payload = buildNotebookFilePayload({
      notebookId: "notebook-1",
      folderId: "folder-1",
      fileName: "  Biology paper.pdf  ",
      fileType: "application/pdf",
      storagePath: "users/alice/notebookFiles/notebook-1/file-1-biology-paper.pdf",
      pageCount: 3,
      sizeBytes: 1024,
      now: 70,
    });
    const file = mapNotebookFileData("file-1", payload);

    expect(file).toMatchObject({
      id: "file-1",
      notebookId: "notebook-1",
      folderId: "folder-1",
      fileName: "Biology paper.pdf",
      fileType: "application/pdf",
      pageCount: 3,
      sizeBytes: 1024,
      uploadedAt: 70,
    });
    expect(
      buildNotebookStoragePath({
        userId: "alice",
        notebookId: "notebook-1",
        fileId: "file-1",
        fileName: "Biology Paper 2024.pdf",
      })
    ).toBe("users/alice/notebookFiles/notebook-1/file-1-biology-paper-2024.pdf");
  });
});
