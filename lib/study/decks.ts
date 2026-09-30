import type {
  DeckColorPresetId,
  DeckIconPresetId,
} from "@/lib/study/deck-style";

export type Deck = {
  id: string;
  name: string;
  userId: string;
  createdAt: number;
  colorPreset: DeckColorPresetId;
  iconPreset: DeckIconPresetId;
  styleVersion?: string;
  folderIds: string[];
};

/**
 * Where drafted cards should go unless the student says otherwise: the deck
 * they were studying, else a deck in the folder the conversation sits in,
 * else their newest deck. `decks` is expected newest first.
 */
export function chooseDraftDestinationDeck(
  decks: readonly Pick<Deck, "id" | "folderIds">[],
  hint: { deckId?: string; folderId?: string }
) {
  if (hint.deckId && decks.some((deck) => deck.id === hint.deckId)) return hint.deckId;
  const inFolder = hint.folderId
    ? decks.find((deck) => deck.folderIds.includes(hint.folderId!))
    : undefined;
  return inFolder?.id ?? decks[0]?.id ?? "";
}
