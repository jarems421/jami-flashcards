// @vitest-environment jsdom

import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCardBulkActions,
  type CardBulkActionsController,
} from "@/hooks/useCardBulkActions";
import type { Card } from "@/lib/study/cards";

const mocks = vi.hoisted(() => ({
  deleteCards: vi.fn(),
  moveCardsToDeck: vi.fn(),
  setCardTopicsInBulk: vi.fn(),
}));

vi.mock("@/services/study/cards", () => ({
  deleteCards: mocks.deleteCards,
  moveCardsToDeck: mocks.moveCardsToDeck,
  setCardTopicsInBulk: mocks.setCardTopicsInBulk,
}));

function card(id: string, topicIds: string[] = []): Card {
  return {
    id,
    front: `${id} front`,
    back: `${id} back`,
    deckId: "deck-1",
    userId: "user-1",
    createdAt: 1,
    tags: [],
    topicIds,
  };
}

const feedback = {
  clear: vi.fn(),
  showError: vi.fn(),
  success: vi.fn(),
};

let container: HTMLDivElement;
let root: Root;
let bulk: CardBulkActionsController;
let renderedCards: Card[];
let renderedSelectedIds: string[];

function Harness({ resetKey = 0 }: { resetKey?: number }) {
  const [cards, setCards] = useState([card("card-1"), card("card-2")]);
  const [selectedCardIds, setSelectedCardIds] = useState([
    "card-1",
    "card-2",
  ]);
  const value = useCardBulkActions({
    cards,
    setCards,
    visibleCardIds: cards.map((item) => item.id),
    selectedCardIds,
    setSelectedCardIds,
    topicSelectionResetKey: resetKey,
    feedback,
  });
  useEffect(() => {
    renderedCards = cards;
    renderedSelectedIds = selectedCardIds;
    bulk = value;
  });
  return null;
}

function render(resetKey = 0) {
  act(() => root.render(<Harness resetKey={resetKey} />));
}

beforeEach(() => {
  mocks.deleteCards.mockReset().mockResolvedValue(undefined);
  mocks.moveCardsToDeck.mockReset().mockResolvedValue(undefined);
  mocks.setCardTopicsInBulk.mockReset().mockResolvedValue(undefined);
  feedback.clear.mockReset();
  feedback.showError.mockReset();
  feedback.success.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useCardBulkActions", () => {
  it("adds Topics to selected cards and updates local state", async () => {
    render();
    act(() => bulk.topics.setIds(["topic-1"]));

    await act(async () => bulk.topics.apply());

    expect(mocks.setCardTopicsInBulk).toHaveBeenCalledWith([
      { id: "card-1", topicIds: ["topic-1"] },
      { id: "card-2", topicIds: ["topic-1"] },
    ]);
    expect(renderedCards.map((item) => item.topicIds)).toEqual([
      ["topic-1"],
      ["topic-1"],
    ]);
    expect(renderedSelectedIds).toEqual([]);
    expect(feedback.success).toHaveBeenCalledWith("Added Topics to 2 cards.");
  });

  it("moves and deletes only the selected cards", async () => {
    render();
    act(() => bulk.move.setDeckId("deck-2"));
    await act(async () => bulk.move.apply());

    expect(mocks.moveCardsToDeck).toHaveBeenCalledWith(
      ["card-1", "card-2"],
      "deck-2"
    );
    expect(renderedCards.every((item) => item.deckId === "deck-2")).toBe(true);

    act(() => bulk.selection.selectVisible());
    act(() => bulk.deletion.setPending(true));
    await act(async () => bulk.deletion.confirm());

    expect(mocks.deleteCards).toHaveBeenCalledWith(["card-1", "card-2"]);
    expect(renderedCards).toEqual([]);
    expect(renderedSelectedIds).toEqual([]);
    expect(bulk.deletion.pending).toBe(false);
  });

  it("resets a prepared Topic choice when imported cards replace selection", () => {
    render(0);
    act(() => bulk.topics.setIds(["topic-1"]));
    expect(bulk.topics.ids).toEqual(["topic-1"]);

    render(1);
    expect(bulk.topics.ids).toEqual([]);
  });
});
