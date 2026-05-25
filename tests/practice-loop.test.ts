import { afterEach, describe, expect, it, vi } from "vitest";
import { isFeatureEnabled } from "@/lib/app/feature-flags";
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
import {
  getObjectColorPreset,
  normalizeObjectColor,
  normalizeObjectIcon,
} from "@/components/workspace/object-card-styles";
import {
  buildNotebookFilePayload,
  buildNotebookPagePayload,
  buildNotebookPayload,
  mapNotebookData,
  mapNotebookFileData,
  mapNotebookPageData,
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
      description: " History, politics, and source analysis. ",
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
    expect(normalizeObjectIcon("file")).toBe("file");
    expect(normalizeObjectIcon("random-icon")).toBe("book");
    expect(getObjectColorPreset("rose")).toMatchObject({
      id: "rose",
      label: "Rose",
    });
  });

  it("validates notebook pages as the active working surface", () => {
    const notebookPayload = buildNotebookPayload({
      folderId: "folder-science",
      title: "  Photosynthesis practice  ",
      type: "blank",
      topicIds: ["topic-photosynthesis"],
      sourceIds: ["source-class-notes"],
      pageColor: "black",
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
    });
    expect(page).toMatchObject({
      id: "page-1",
      notebookId: "notebook-1",
      folderId: "folder-science",
      pageNumber: 1,
      pageType: "question",
      pageColor: "black",
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

  it("validates notebook file metadata for uploaded-file notebooks without parsing the file", () => {
    const payload = buildNotebookFilePayload({
      notebookId: "notebook-1",
      folderId: "folder-1",
      fileName: "  Biology paper.pdf  ",
      fileType: "application/pdf",
      storagePath: "users/alice/notebookFiles/notebook-1/file-1-biology-paper.pdf",
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
