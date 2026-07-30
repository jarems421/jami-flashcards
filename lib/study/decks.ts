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
