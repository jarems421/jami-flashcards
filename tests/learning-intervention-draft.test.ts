import { describe, expect, it } from "vitest";
import {
  draftSize,
  editDraftItem,
  isConfirmable,
  removeDraftItem,
  type InterventionDraft,
} from "@/lib/learning/interventions/draft";

/**
 * The parts of reviewing a draft that are the same whatever was generated.
 *
 * Both generators stop at the same place, so these semantics are decided once:
 * a draft is a proposal, not material and not evidence; editing may not break
 * what the generator was held to; and confirming nothing must be impossible.
 */

const NOW = Date.parse("2026-09-22T09:00:00.000Z");

function cardDraft(): InterventionDraft {
  return {
    interventionId: "folder:f1|low_mastery|spec:x",
    conceptId: "spec-concept",
    conceptLabel: "Completing the square",
    payload: {
      kind: "create_flashcards",
      cards: [
        { front: "One", back: "1" },
        { front: "Two", back: "2" },
      ],
    },
    dropped: 1,
    generatedAt: NOW,
  };
}

function questionDraft(): InterventionDraft {
  return {
    interventionId: "folder:f1|low_mastery|spec:x",
    conceptId: "spec-concept",
    conceptLabel: "Completing the square",
    payload: {
      kind: "create_practice",
      questions: [
        {
          prompt: "Solve it",
          marks: 3,
          answer: "Like this",
          points: [
            { marks: 1, text: "Sets up" },
            { marks: 2, text: "Solves" },
          ],
        },
      ],
    },
    dropped: 0,
    generatedAt: NOW,
  };
}

describe("a draft is a proposal, not material", () => {
  it("counts what it proposes, whatever kind it is", () => {
    expect(draftSize(cardDraft())).toBe(2);
    expect(draftSize(questionDraft())).toBe(1);
  });

  it("carries the intervention and concept on the draft itself", () => {
    // So everything written from it inherits them, whichever editor was used.
    for (const draft of [cardDraft(), questionDraft()]) {
      expect(draft.interventionId).toBeTruthy();
      expect(draft.conceptId).toBeTruthy();
    }
  });

  it("cannot be confirmed once the student has removed everything", () => {
    let draft = cardDraft();
    while (draftSize(draft) > 0) {
      const result = removeDraftItem(draft, 0);
      if (!result.ok) throw new Error("expected a removal");
      draft = result.draft;
    }
    expect(draftSize(draft)).toBe(0);
    // Confirming nothing would write nothing and still look like advice taken.
    expect(isConfirmable(draft)).toBe(false);
  });
});

describe("editing may not break what the generator was held to", () => {
  it("refuses a card with a side emptied", () => {
    expect(editDraftItem(cardDraft(), 0, { front: "", back: "1" })).toEqual({
      ok: false,
      reason: "empty_field",
    });
    expect(editDraftItem(cardDraft(), 0, { front: "One", back: "   " })).toEqual({
      ok: false,
      reason: "empty_field",
    });
  });

  it("accepts a card the student rewrote, trimming it", () => {
    const result = editDraftItem(cardDraft(), 0, { front: "  Edited  ", back: "  Yes  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.draft.payload;
    expect(payload.kind === "create_flashcards" && payload.cards[0]).toEqual({
      front: "Edited",
      back: "Yes",
    });
  });

  it("refuses a question whose scheme no longer accounts for its marks", () => {
    const draft = questionDraft();
    const broken = {
      prompt: "Solve it",
      marks: 5,
      answer: "Like this",
      points: [{ marks: 1, text: "Sets up" }],
    };
    // The same rule the generator was held to, applied to a person -- because
    // an unmarkable question is discovered only after it has been sat.
    expect(editDraftItem(draft, 0, broken)).toEqual({ ok: false, reason: "marks_disagree" });
  });

  it("accepts a question whose scheme the student rebalanced", () => {
    const result = editDraftItem(questionDraft(), 0, {
      prompt: "Solve it properly",
      marks: 4,
      answer: "Like this",
      points: [
        { marks: 2, text: "Sets up" },
        { marks: 2, text: "Solves" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an item of the wrong kind for this draft", () => {
    // The payload says which editor is on screen; TypeScript cannot carry that
    // across a callback, so the shape is checked rather than assumed.
    const question = {
      prompt: "Solve it",
      marks: 1,
      answer: "x",
      points: [{ marks: 1, text: "y" }],
    };
    expect(editDraftItem(cardDraft(), 0, question)).toEqual({
      ok: false,
      reason: "wrong_item_type",
    });
    expect(editDraftItem(questionDraft(), 0, { front: "a", back: "b" })).toEqual({
      ok: false,
      reason: "wrong_item_type",
    });
  });

  it("refuses an item that is not there", () => {
    expect(editDraftItem(cardDraft(), 9, { front: "a", back: "b" })).toEqual({
      ok: false,
      reason: "unknown_item",
    });
    expect(removeDraftItem(cardDraft(), -1)).toEqual({ ok: false, reason: "unknown_item" });
  });
});

describe("editing never mutates what it was given", () => {
  it("leaves the original draft untouched", () => {
    const original = cardDraft();
    const before = JSON.stringify(original);
    editDraftItem(original, 0, { front: "Changed", back: "Changed" });
    removeDraftItem(original, 0);
    // Cancelling has to leave nothing behind, which starts with not editing
    // the caller's copy in place.
    expect(JSON.stringify(original)).toBe(before);
  });
});
