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
