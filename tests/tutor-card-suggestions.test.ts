import { describe, expect, it } from "vitest";
import {
  invitesTutorCardSuggestions,
  MAX_TUTOR_CARD_SUGGESTIONS,
  normalizeSuggestedCards,
  readTutorCardSuggestions,
} from "@/lib/ai/tutor-card-suggestions";
import { toggleSourceSelection } from "@/lib/material/source-selectors";

describe("when Tutor may suggest flashcards", () => {
  it("offers cards when the student asks for them and there is a source to save them against", () => {
    for (const message of [
      "Make flashcards from this.",
      "can you make me some cards on osmosis",
      "Give me 5 flash cards about enzymes",
      "Help me remember this",
      "anki cards for chapter 3 please",
    ]) {
      expect(invitesTutorCardSuggestions({ message, readableSourceCount: 2 })).toBe(true);
    }
  });

  it("does not answer an ordinary question with cards, or offer cards with no source", () => {
    expect(
      invitesTutorCardSuggestions({ message: "What is osmosis?", readableSourceCount: 3 })
    ).toBe(false);
    expect(
      invitesTutorCardSuggestions({ message: "Make flashcards from this.", readableSourceCount: 0 })
    ).toBe(false);
  });
});

describe("reading the cards the model offered", () => {
  const evidence = new Map([
    [
      "S1",
      [
        "Osmosis is the net movement of water molecules from a region of higher water potential to a region of lower water potential through a partially permeable membrane.",
      ],
    ],
  ]);

  it("keeps usable cards and drops ones with a missing side, an unknown source or a repeated front", () => {
    const cards = readTutorCardSuggestions(
      [
        { front: "Why does a cell placed in pure water swell?", back: "Water moves in by osmosis.", sourceRef: "S1" },
        { front: "Why does a cell placed in pure water swell?", back: "Duplicate.", sourceRef: "S1" },
        { front: "Missing back", back: "", sourceRef: "S1" },
        { front: "From nowhere", back: "Invented.", sourceRef: "S9" },
        "not a card",
      ],
      { allowedSourceRefs: ["S1"], evidenceBySourceRef: evidence }
    );

    expect(cards).toEqual([
      {
        front: "Why does a cell placed in pure water swell?",
        back: "Water moves in by osmosis.",
        sourceRef: "S1",
      },
    ]);
  });

  it("drops a card that copies a sentence from its source", () => {
    const cards = readTutorCardSuggestions(
      [
        {
          front: "What is osmosis?",
          back: "The net movement of water molecules from a region of higher water potential to a region of lower water potential through a partially permeable membrane.",
          sourceRef: "S1",
        },
      ],
      { allowedSourceRefs: ["S1"], evidenceBySourceRef: evidence }
    );

    expect(cards).toEqual([]);
  });

  it("never offers more than the cap", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      front: `Question ${index}?`,
      back: `Answer ${index}.`,
      sourceRef: "S1",
    }));

    expect(readTutorCardSuggestions(many, { allowedSourceRefs: ["S1"] })).toHaveLength(
      MAX_TUTOR_CARD_SUGGESTIONS
    );
  });

  it("reads saved suggestions back, discarding malformed ones", () => {
    expect(
      normalizeSuggestedCards([
        { front: "Q", back: "A", sourceId: "source-1", sourceTitle: "Notes", topicIds: ["t1", 4] },
        { front: "Q", back: "A" },
      ])
    ).toEqual([{ front: "Q", back: "A", sourceId: "source-1", sourceTitle: "Notes", topicIds: ["t1"] }]);
  });
});

describe("choosing several sources for Tutor", () => {
  it("adds and removes, and refuses to go past the limit rather than dropping a choice", () => {
    expect(toggleSourceSelection([], "a", 2)).toEqual(["a"]);
    expect(toggleSourceSelection(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(toggleSourceSelection(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(toggleSourceSelection(["a", "b"], "a", 2)).toEqual(["b"]);
  });
});
