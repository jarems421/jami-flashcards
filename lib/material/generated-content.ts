import type {
  ContentOrigin,
  ContentStatus,
} from "@/lib/material/content";

export type GeneratedContentKind =
  | "flashcard"
  | "practice-question"
  | "topic-suggestion"
  | "summary"
  | "misconception-label"
  | "similar-question";

export type GeneratedContentDraft = {
  id: string;
  kind: GeneratedContentKind;
  title: string;
  front?: string;
  back?: string;
  questionText?: string;
  answerText?: string;
  solutionText?: string;
  topicIds: string[];
  origin: ContentOrigin;
  contentStatus: ContentStatus;
  reviewedAt?: number;
  reviewedBy?: string;
  sourceType?: "card" | "question" | "tutor" | "manual" | "source";
  sourceId?: string;
  /**
   * Where a Tutor draft was made: the folder its chat sat in, and the deck
   * being studied. Only hints for choosing a deck when it is reviewed later.
   */
  folderId?: string;
  deckId?: string;
  createdAt: number;
  updatedAt: number;
};

export type FlashcardDraftCardData = {
  deckId: string;
  userId: string;
  front: string;
  back: string;
  tags: string[];
  topicIds: string[];
  sourceIds: string[];
  createdAt: number;
};

type FlashcardDraftInput = {
  id?: string;
  kind: string;
  title?: string;
  front?: string;
  back?: string;
  topicIds: string[];
  origin?: string;
  contentStatus: string;
  sourceType?: string;
  sourceId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type PracticeQuestionDraftNotebookPageData = {
  title: string;
  pageType: "question";
  questionPrompt: string;
  /**
   * The expected answer and solution notes, kept with the page but off it.
   *
   * They used to be written onto the page as typed text, so a student opening
   * a practice question found its answer printed underneath before they had
   * written a line. The question card reveals them on request, and Tutor
   * marks against them.
   */
  questionAnswer: string | null;
  linkedSourceId: string | null;
  status: "blank";
};

export function buildFlashcardDraftCardData(
  draft: FlashcardDraftInput,
  input: {
    userId: string;
    deckId: string;
    now?: number;
  }
): FlashcardDraftCardData {
  const userId = input.userId.trim();
  const deckId = input.deckId.trim();
  const front = draft.front?.trim() ?? "";
  const back = draft.back?.trim() ?? "";

  if (!userId) {
    throw new Error("Missing userId.");
  }
  if (!deckId) {
    throw new Error("Choose a destination deck first.");
  }
  if (draft.kind !== "flashcard") {
    throw new Error("Only flashcard drafts can be added to a deck.");
  }
  if (draft.contentStatus !== "draft") {
    throw new Error("Flashcard draft must still be a draft before it can be added to a deck.");
  }
  if (!front || !back) {
    throw new Error("Flashcard drafts need both a front and back before they can become cards.");
  }

  return {
    deckId,
    userId,
    front: front.slice(0, 1_000),
    back: back.slice(0, 4_000),
    tags: [],
    topicIds: draft.topicIds,
    sourceIds: draft.sourceId ? [draft.sourceId] : [],
    createdAt: input.now ?? Date.now(),
  };
}

export function buildPracticeQuestionDraftNotebookPageData(
  draft: FlashcardDraftInput & {
    questionText?: string;
    answerText?: string;
    solutionText?: string;
  }
): PracticeQuestionDraftNotebookPageData {
  const questionText = draft.questionText?.trim() ?? "";
  const answerText = draft.answerText?.trim() ?? "";
  const solutionText = draft.solutionText?.trim() ?? "";

  if (draft.kind !== "practice-question") {
    throw new Error("Only practice question drafts can become notebook pages.");
  }
  if (draft.contentStatus !== "draft") {
    throw new Error("Practice question draft must still be a draft before approval.");
  }
  if (!questionText) {
    throw new Error("Practice question drafts need question text before approval.");
  }

  return {
    title: draft.title?.trim().slice(0, 120) || "Question page",
    pageType: "question",
    questionPrompt: questionText.slice(0, 4_000),
    questionAnswer:
      answerText || solutionText
        ? [
            answerText ? `Expected answer:\n${answerText.slice(0, 4_000)}` : "",
            solutionText ? `Solution notes:\n${solutionText.slice(0, 8_000)}` : "",
          ].filter(Boolean).join("\n\n")
        : null,
    linkedSourceId: draft.sourceId?.trim() || null,
    status: "blank",
  };
}
