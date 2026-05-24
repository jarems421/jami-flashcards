import { afterEach, describe, expect, it, vi } from "vitest";
import { isFeatureEnabled } from "@/lib/app/feature-flags";
import { mapCardData } from "@/lib/study/cards";
import { getAttemptMasteryWeight, getMasteryScoreDelta } from "@/lib/practice/mastery";
import { buildTopicProgress } from "@/lib/practice/progress";
import { mapQuestionData, normalizeConfidence } from "@/lib/practice/questions";
import { mapTopicData, slugifyTopicName } from "@/lib/practice/topics";
import {
  buildFlashcardDraftCardData,
  buildPracticeQuestionDraftData,
} from "@/lib/practice/generated-content";
import { buildSourcePayload, mapSourceData } from "@/lib/practice/sources";
import {
  buildTutorContextPacket,
  formatTutorContextPacketForPrompt,
  normalizeTutorContextPacket,
} from "@/lib/practice/tutor-context";
import {
  buildStudyFolderPayload,
  mapStudyFolderData,
} from "@/lib/workspace/study-folders";
import {
  buildNotebookPagePayload,
  buildNotebookPayload,
  buildNotebookFilePayload,
  mapNotebookData,
  mapNotebookFileData,
  mapNotebookPageData,
} from "@/lib/workspace/notebooks";
import {
  buildPastPaperPayload,
  buildPracticeSetPayload,
  mapPastPaperData,
  mapPracticeSetData,
} from "@/lib/workspace/practice-sets";
import { buildNotebookStoragePath } from "@/services/study/notebook-files";

describe("Jami learning loop foundations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps topics distinct from flexible card tags", () => {
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "user-1",
      front: "Define eigenvalue",
      back: "A scalar lambda where Av = lambda v for non-zero v.",
      tags: ["exam", "week-5"],
      topicIds: ["topic-eigenvalues"],
      createdAt: 1,
    });

    expect(card.tags).toEqual(["exam", "week-5"]);
    expect(card.topicIds).toEqual(["topic-eigenvalues"]);
  });

  it("allows feature flags to be disabled by environment", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_PRACTISE", "false");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LIBRARY", "true");

    expect(isFeatureEnabled("enablePractise")).toBe(false);
    expect(isFeatureEnabled("enableLibrary")).toBe(true);
  });

  it("keeps Library enabled by default for the source loop", () => {
    expect(isFeatureEnabled("enableLibrary")).toBe(true);
  });

  it("keeps the folder and notebook workspace enabled by default while flashcard AI stays scoped down", () => {
    expect(isFeatureEnabled("enableFolders")).toBe(true);
    expect(isFeatureEnabled("enableNotebooks")).toBe(true);
    expect(isFeatureEnabled("enableFlashcardAi")).toBe(false);
  });

  it("normalizes topic and question data for the practice loop", () => {
    expect(slugifyTopicName("  Integration by Parts! ")).toBe("integration-by-parts");

    const topic = mapTopicData("topic-1", {
      name: "  Integration by Parts  ",
      subject: " Analysis 2 ",
      aliases: ["IBP", "integration parts"],
      status: "active",
      createdBy: "ai-suggested",
      createdAt: 1,
      updatedAt: 2,
    });
    const question = mapQuestionData("question-1", {
      questionText: "Evaluate the integral.",
      topicIds: ["topic-1"],
      sourceType: "manual",
      origin: "user-authored",
      contentStatus: "approved",
      createdAt: 3,
      updatedAt: 4,
    });

    expect(topic.slug).toBe("integration-by-parts");
    expect(topic.createdBy).toBe("ai-suggested");
    expect(question.topicIds).toEqual(["topic-1"]);
    expect(question.contentStatus).toBe("approved");
    expect(normalizeConfidence(99)).toBe(5);
  });

  it("weights mastery from user evidence, not AI explanations alone", () => {
    expect(
      getAttemptMasteryWeight({
        isCorrect: true,
        confidence: 5,
        hintsUsed: 0,
        tutorUsed: false,
      })
    ).toBe("high");
    expect(
      getAttemptMasteryWeight({
        isCorrect: true,
        confidence: 3,
        hintsUsed: 1,
        tutorUsed: true,
      })
    ).toBe("medium");
    expect(
      getAttemptMasteryWeight({
        isCorrect: false,
        confidence: 2,
        hintsUsed: 2,
        tutorUsed: true,
      })
    ).toBe("negative");
    expect(getMasteryScoreDelta("neutral")).toBe(0);
  });

  it("builds a narrow progress summary from cards, attempts, and mastery events", () => {
    const topic = mapTopicData("topic-1", {
      name: "Eigenvalues",
      subject: "Linear Algebra",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "user-1",
      front: "What is an eigenvalue?",
      back: "A scalar lambda where Av = lambda v.",
      topicIds: ["topic-1"],
      tags: ["exam"],
      createdAt: 1,
      dueDate: 1,
      difficulty: 8,
      reps: 2,
    });
    const question = mapQuestionData("question-1", {
      questionText: "Find the eigenvalues.",
      topicIds: ["topic-1"],
      sourceType: "manual",
      origin: "user-authored",
      contentStatus: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    const summary = buildTopicProgress({
      topics: [topic],
      cards: [card],
      questions: [question],
      attempts: [
        {
          id: "attempt-1",
          questionId: "question-1",
          userAnswer: "wrong",
          isCorrect: false,
          confidence: 2,
          tutorUsed: true,
          hintsUsed: 2,
          mistakeLabels: ["conceptual mix-up"],
          createdAt: 2,
        },
      ],
      masteryEvents: [
        {
          id: "event-1",
          topicId: "topic-1",
          sourceType: "question",
          sourceId: "attempt-1",
          weight: "negative",
          scoreDelta: -2,
          reason: "Incorrect practice attempt",
          algorithmVersion: "test",
          createdAt: 2,
        },
      ],
      now: 10,
    });

    expect(summary[0].topic.name).toBe("Eigenvalues");
    expect(summary[0].weakCardCount).toBe(1);
    expect(summary[0].accuracy).toBe(0);
    expect(summary[0].supportLevel).toBe("High");
    expect(summary[0].recentMistakes).toEqual(["conceptual mix-up"]);
    expect(summary[0].masteryScore).toBe(-2);
  });

  it("turns an approved tutor flashcard draft into card data without losing provenance", () => {
    const card = buildFlashcardDraftCardData(
      {
        id: "draft-1",
        kind: "flashcard",
        title: "Multiplicity",
        front: " What is geometric multiplicity? ",
        back: " The dimension of the eigenspace. ",
        topicIds: ["topic-multiplicity"],
        origin: "ai-assisted",
        contentStatus: "draft",
        sourceType: "question",
        sourceId: "question-1",
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
      front: "What is geometric multiplicity?",
      back: "The dimension of the eigenspace.",
      tags: [],
      topicIds: ["topic-multiplicity"],
      sourceIds: ["question-1"],
      createdAt: 10,
    });
  });

  it("validates and maps saved Library sources", () => {
    const payload = buildSourcePayload("user-1", {
      title: " Lecture 5 notes ",
      type: "pasted_text",
      subject: " Linear Algebra ",
      topicIds: ["topic-eigenvalues"],
      contentText: " Eigenvalues help test diagonalisation. ",
      now: 10,
    });
    const source = mapSourceData("source-1", payload);

    expect(source).toMatchObject({
      id: "source-1",
      title: "Lecture 5 notes",
      type: "pasted_text",
      subject: "Linear Algebra",
      topicIds: ["topic-eigenvalues"],
      contentText: "Eigenvalues help test diagonalisation.",
      status: "active",
      createdBy: "user-1",
      createdAt: 10,
      updatedAt: 10,
    });
    expect(() =>
      buildSourcePayload("user-1", {
        title: "Empty source",
        type: "pasted_text",
        contentText: "",
      })
    ).toThrow("Paste or write source text");
    expect(() =>
      buildSourcePayload("user-1", {
        title: "Bad link",
        type: "link",
        externalUrl: "not a url",
      })
    ).toThrow("valid source link");
  });

  it("validates and maps broad study folders separately from topics", () => {
    const payload = buildStudyFolderPayload({
      name: "  Linear   Algebra  ",
      description: " Eigenvalues, diagonalisation, decks, sources, and notebook work. ",
      subject: " Maths ",
      topicIds: ["topic-eigenvalues", "topic-eigenvalues", "topic-diagonalisation"],
      now: 40,
    });
    const folder = mapStudyFolderData("folder-1", payload);

    expect(folder).toMatchObject({
      id: "folder-1",
      name: "Linear Algebra",
      description: "Eigenvalues, diagonalisation, decks, sources, and notebook work.",
      subject: "Maths",
      topicIds: ["topic-eigenvalues", "topic-diagonalisation"],
      archived: false,
      createdAt: 40,
      updatedAt: 40,
    });
    expect(() => buildStudyFolderPayload({ name: "" })).toThrow("Folder name is required");
  });

  it("validates and maps notebook pages as the future working surface", () => {
    const notebookPayload = buildNotebookPayload({
      folderId: "folder-linear-algebra",
      title: "  Eigenvalues   practice  ",
      type: "practice",
      topicIds: ["topic-eigenvalues"],
      sourceIds: ["source-lecture-5"],
      pageColor: "black",
      now: 50,
    });
    const notebook = mapNotebookData("notebook-1", notebookPayload);
    const pagePayload = buildNotebookPagePayload({
      notebookId: notebook.id,
      folderId: notebook.folderId,
      pageNumber: 1,
      pageType: "question",
      questionPrompt: "Find the eigenvalues of A.",
      typedContent: "I will start with det(A - lambda I).",
      strokeData: {
        version: 1,
        strokes: [{ points: [{ x: 1, y: 2 }], color: "white", width: 5, tool: "pen" }],
      },
      pageColor: "black",
      status: "working",
      linkedSourceId: "source-lecture-5",
      now: 60,
    });
    const page = mapNotebookPageData("page-1", pagePayload);

    expect(notebook).toMatchObject({
      id: "notebook-1",
      folderId: "folder-linear-algebra",
      title: "Eigenvalues practice",
      type: "practice",
      topicIds: ["topic-eigenvalues"],
      sourceIds: ["source-lecture-5"],
      pageColor: "black",
      archived: false,
      createdAt: 50,
      updatedAt: 50,
    });
    expect(page).toMatchObject({
      id: "page-1",
      notebookId: "notebook-1",
      folderId: "folder-linear-algebra",
      pageNumber: 1,
      pageType: "question",
      pageColor: "black",
      status: "working",
      questionPrompt: "Find the eigenvalues of A.",
      typedContent: "I will start with det(A - lambda I).",
      linkedSourceId: "source-lecture-5",
      createdAt: 60,
      updatedAt: 60,
    });
    expect(page.strokeData?.strokes).toHaveLength(1);
    expect(page.strokeData?.strokes[0]).toMatchObject({
      color: "white",
      width: 5,
      tool: "pen",
    });
    expect(() => buildNotebookPayload({ folderId: "", title: "Notebook" })).toThrow("folder");
    expect(() =>
      buildNotebookPagePayload({
        notebookId: "notebook-1",
        folderId: "folder-1",
        pageNumber: 0,
      })
    ).toThrow("Page number");
  });

  it("validates notebook file metadata for uploaded-file notebooks", () => {
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
    expect(() =>
      buildNotebookFilePayload({
        notebookId: "",
        folderId: "folder-1",
        fileName: "paper.pdf",
        fileType: "application/pdf",
        storagePath: "users/alice/notebookFiles/notebook-1/paper.pdf",
      })
    ).toThrow("notebook");
    expect(
      buildNotebookStoragePath({
        userId: "alice",
        notebookId: "notebook-1",
        fileId: "file-1",
        fileName: "Biology Paper 2024.pdf",
      })
    ).toBe("users/alice/notebookFiles/notebook-1/file-1-biology-paper-2024.pdf");
  });

  it("validates practice set and past paper shells without PDF annotation", () => {
    const practiceSetPayload = buildPracticeSetPayload({
      folderId: "folder-linear-algebra",
      title: "  Eigenvalues   drill  ",
      type: "manual",
      topicIds: ["topic-eigenvalues"],
      questionIds: ["question-1", "question-1"],
      now: 70,
    });
    const practiceSet = mapPracticeSetData("set-1", practiceSetPayload);
    const pastPaperPayload = buildPastPaperPayload({
      folderId: "folder-linear-algebra",
      title: "  2024   Linear Algebra paper  ",
      year: " 2024 ",
      module: " Linear Algebra ",
      fileName: "linear-algebra-2024.pdf",
      pageCount: 0,
      now: 80,
    });
    const pastPaper = mapPastPaperData("paper-1", pastPaperPayload);

    expect(practiceSet).toMatchObject({
      id: "set-1",
      folderId: "folder-linear-algebra",
      title: "Eigenvalues drill",
      type: "manual",
      topicIds: ["topic-eigenvalues"],
      questionIds: ["question-1"],
      archived: false,
      createdAt: 70,
      updatedAt: 70,
    });
    expect(pastPaper).toMatchObject({
      id: "paper-1",
      folderId: "folder-linear-algebra",
      title: "2024 Linear Algebra paper",
      year: "2024",
      module: "Linear Algebra",
      fileName: "linear-algebra-2024.pdf",
      pageCount: 0,
      archived: false,
      createdAt: 80,
      updatedAt: 80,
    });
    expect(() => buildPracticeSetPayload({ folderId: "", title: "Set" })).toThrow("folder");
    expect(() => buildPastPaperPayload({ folderId: "folder-1", title: "" })).toThrow(
      "Past paper title"
    );
  });

  it("approves source practice drafts into questions with source links", () => {
    const question = buildPracticeQuestionDraftData(
      {
        id: "draft-question-1",
        kind: "practice-question",
        title: "Diagonalisation",
        questionText: "State the diagonalisation criterion.",
        answerText: "There must be enough independent eigenvectors.",
        solutionText: "Compare algebraic and geometric multiplicity.",
        topicIds: ["topic-eigenvalues"],
        origin: "source-derived",
        contentStatus: "draft",
        sourceType: "source",
        sourceId: "source-lecture-5",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        userId: "user-1",
        now: 20,
      }
    );

    expect(question).toMatchObject({
      questionText: "State the diagonalisation criterion.",
      answerText: "There must be enough independent eigenvectors.",
      solutionText: "Compare algebraic and geometric multiplicity.",
      topicIds: ["topic-eigenvalues"],
      sourceType: "ai-generated",
      origin: "source-derived",
      contentStatus: "approved",
      reviewedAt: 20,
      reviewedBy: "user-1",
      sourceIds: ["source-lecture-5"],
      createdAt: 20,
      updatedAt: 20,
    });
  });

  it("rejects draft-to-card conversion for unsafe draft states", () => {
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
      buildFlashcardDraftCardData(
        {
          kind: "flashcard",
          front: "Front",
          back: "",
          topicIds: [],
          contentStatus: "draft",
        },
        { userId: "user-1", deckId: "deck-1" }
      )
    ).toThrow("both a front and back");

    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "flashcard",
          front: "Front",
          back: "Back",
          topicIds: [],
          contentStatus: "approved",
        },
        { userId: "user-1", deckId: "deck-1" }
      )
    ).toThrow("must still be a draft");

    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "flashcard",
          front: "Front",
          back: "Back",
          topicIds: [],
          contentStatus: "draft",
        },
        { userId: "user-1", deckId: "" }
      )
    ).toThrow("destination deck");
  });

  it("builds a capped Tutor context packet from the current practice workspace", () => {
    const question = mapQuestionData("question-1", {
      questionText: "Solve x^2 - 5x + 6 = 0",
      answerText: "x = 2 or x = 3",
      solutionText: "Factorise into (x - 2)(x - 3), then use the zero-product rule.",
      topicIds: ["topic-factorising"],
      sourceIds: ["source-algebra"],
      sourceType: "manual",
      origin: "user-authored",
      contentStatus: "approved",
      createdAt: 1,
      updatedAt: 1,
    });
    const packet = buildTutorContextPacket({
      question,
      topics: [
        mapTopicData("topic-factorising", {
          name: "Factorising quadratics",
          subject: "Algebra",
          createdAt: 1,
          updatedAt: 1,
        }),
      ],
      sources: [
        mapSourceData("source-algebra", {
          title: "Quadratics notes",
          type: "pasted_text",
          topicIds: ["topic-factorising"],
          contentText: "Use factor pairs to solve quadratics.",
          status: "active",
          createdBy: "user-1",
          createdAt: 1,
          updatedAt: 1,
        }),
      ],
      attempts: Array.from({ length: 7 }, (_, index) => ({
        id: `attempt-${index}`,
        questionId: "question-1",
        userAnswer: `answer ${index}`,
        workingText: `working ${index}`,
        isCorrect: index === 0,
        confidence: 2,
        tutorUsed: index > 2,
        mistakeLabels: [`mistake ${index}`],
        createdAt: index,
      })),
      tutorMessages: Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("model" as const),
        text: `message ${index}`,
        intent: "hint",
      })),
      intent: "stuck-here",
      typedAnswer: "x = 2?",
      typedWorking: "x^2 - 5x + 6 = (x - 2)(x - 3)",
      selectedWorkingText: "(x - 2)(x - 3)",
      scratchpad: {
        hasDrawing: true,
        strokeCount: 3,
        note: "I circled the factorised line.",
      },
      confidence: 2,
      mistakeLabels: "zero product rule, unsure final step",
    });

    expect(packet.question.text).toBe("Solve x^2 - 5x + 6 = 0");
    expect(packet.question.topicNames).toEqual(["Factorising quadratics"]);
    expect(packet.question.sourceTitles).toEqual(["Quadratics notes"]);
    expect(packet.studentState.typedAnswer).toBe("x = 2?");
    expect(packet.studentState.typedWorking).toContain("(x - 2)(x - 3)");
    expect(packet.studentState.selectedWorkingText).toBe("(x - 2)(x - 3)");
    expect(packet.studentState.scratchpad).toEqual({
      hasDrawing: true,
      strokeCount: 3,
      note: "I circled the factorised line.",
      imageAttached: false,
    });
    expect(packet.studentState.mistakeLabels).toEqual(["zero product rule", "unsure final step"]);
    expect(packet.attemptHistory).toHaveLength(5);
    expect(packet.attemptHistory[0].createdAt).toBe(6);
    expect(packet.tutorHistory).toHaveLength(6);
    expect(packet.tutorHistory[0].text).toBe("message 2");
    expect(packet.intent).toBe("stuck-here");
    expect(packet.privacy).toEqual({
      sendsUnsavedWorking: true,
      persistsUnsavedWorking: false,
    });
  });

  it("normalizes Tutor context packets and preserves anti-overhelp prompt context", () => {
    const packet = normalizeTutorContextPacket(
      {
        question: {
          id: "question-1",
          text: "Differentiate x^2",
          topicNames: ["Differentiation"],
          sourceTitles: ["Methods notes"],
        },
        studentState: {
          typedWorking: "d/dx x^2 = x",
          selectedWorkingText: "x",
          mistakeLabels: ["power rule"],
        },
        attemptHistory: Array.from({ length: 10 }, (_, index) => ({
          answer: `answer ${index}`,
          correct: false,
          confidence: 1,
          mistakeLabels: ["rule"],
          createdAt: index,
        })),
        tutorHistory: Array.from({ length: 10 }, (_, index) => ({
          role: "user",
          text: `message ${index}`,
          intent: "hint",
        })),
        privacy: {
          sendsUnsavedWorking: true,
          persistsUnsavedWorking: true,
        },
      },
      "check-working"
    );

    expect(packet?.attemptHistory).toHaveLength(5);
    expect(packet?.tutorHistory).toHaveLength(6);
    expect(packet?.privacy.persistsUnsavedWorking).toBe(false);

    const prompt = packet ? formatTutorContextPacketForPrompt(packet) : "";
    expect(prompt).toContain("Selected working text:");
    expect(prompt).toContain("d/dx x^2 = x");
    expect(prompt).toContain("Scratchpad:");
    expect(prompt).toContain("Context was sent only because the student clicked a Tutor action");
  });
});
