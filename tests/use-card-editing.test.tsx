// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCardEditing,
  type CardEditingController,
} from "@/hooks/useCardEditing";
import type { Card } from "@/lib/study/cards";

const mocks = vi.hoisted(() => ({
  deleteCard: vi.fn(),
  updateCardContent: vi.fn(),
}));

vi.mock("@/services/study/cards", () => ({
  deleteCard: mocks.deleteCard,
  updateCardContent: mocks.updateCardContent,
}));

const startingCard: Card = {
  id: "card-1",
  front: "Question",
  back: "Answer",
  deckId: "deck-1",
  userId: "user-1",
  createdAt: 1,
  tags: [],
  topicIds: ["topic-1"],
};

const feedback = {
  clear: vi.fn(),
  showError: vi.fn(),
  success: vi.fn(),
};
const onCardDeleted = vi.fn();

let container: HTMLDivElement;
let root: Root;
let editing: CardEditingController;
let renderedCards: Card[];

function Harness() {
  const [cards, setCards] = useState([startingCard]);
  const value = useCardEditing({
    cards,
    setCards,
    onCardDeleted,
    feedback,
  });
  useEffect(() => {
    renderedCards = cards;
    editing = value;
  });
  return null;
}

beforeEach(() => {
  mocks.deleteCard.mockReset().mockResolvedValue(undefined);
  mocks.updateCardContent.mockReset().mockResolvedValue(undefined);
  feedback.clear.mockReset();
  feedback.showError.mockReset();
  feedback.success.mockReset();
  onCardDeleted.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useCardEditing", () => {
  it("moves from preview into an isolated row draft", () => {
    act(() => editing.preview.open("card-1"));
    expect(editing.preview.card?.id).toBe("card-1");

    act(() => editing.preview.edit(editing.preview.card!));
    expect(editing.preview.card).toBeNull();
    expect(editing.rows.isEditing("card-1")).toBe(true);
    expect(editing.draft).toEqual({
      front: "Question",
      back: "Answer",
      topicIds: ["topic-1"],
    });
  });

  it("validates and saves a normalized card draft", async () => {
    act(() => editing.start(startingCard));
    act(() =>
      editing.rows.updateDraft({ front: "  Updated question  ", back: "  Updated answer  " })
    );
    await act(async () => editing.save("card-1"));

    expect(mocks.updateCardContent).toHaveBeenCalledWith("card-1", {
      front: "Updated question",
      back: "Updated answer",
      topicIds: ["topic-1"],
    });
    expect(renderedCards[0]).toMatchObject({
      front: "Updated question",
      back: "Updated answer",
      topicIds: ["topic-1"],
      tags: [],
    });
    expect(editing.rows.editingId).toBeNull();
    expect(feedback.success).toHaveBeenCalledWith("Card updated.");
  });

  it("rejects an incomplete draft without writing", async () => {
    act(() => editing.start(startingCard));
    act(() => editing.rows.updateDraft({ back: "   " }));
    await act(async () => editing.save("card-1"));

    expect(mocks.updateCardContent).not.toHaveBeenCalled();
    expect(feedback.showError).toHaveBeenCalledWith(
      "Both front and back are required."
    );
  });

  it("deletes the pending card and informs selection ownership", async () => {
    act(() => editing.deletion.request("card-1"));
    await act(async () => editing.deletion.confirm());

    expect(mocks.deleteCard).toHaveBeenCalledWith("card-1");
    expect(renderedCards).toEqual([]);
    expect(onCardDeleted).toHaveBeenCalledWith("card-1");
    expect(editing.deletion.pendingCardId).toBeNull();
  });
});
