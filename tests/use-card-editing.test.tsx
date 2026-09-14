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

const storageMocks = vi.hoisted(() => ({
  deleteStorageFile: vi.fn<(path: string) => Promise<undefined>>(async () => undefined),
}));

vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: storageMocks.deleteStorageFile,
  getStorageFileDownloadUrl: vi.fn(async () => "https://files.test/image.png"),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: vi.fn(async () => undefined),
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

function Harness({ initial = [startingCard] }: { initial?: Card[] }) {
  const [cards, setCards] = useState(initial);
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
  storageMocks.deleteStorageFile.mockClear();
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
    // The editor is a dialog over the page, so the message stays with the
    // fields rather than going to the banner behind it.
    expect(editing.error).toBe("Both front and back are required.");
    expect(feedback.showError).not.toHaveBeenCalled();
    expect(editing.rows.isEditing("card-1")).toBe(true);
  });

  it("names the open card and clears a stale error on cancel", async () => {
    act(() => editing.start(startingCard));
    expect(editing.card?.id).toBe("card-1");

    act(() => editing.rows.updateDraft({ front: "  " }));
    await act(async () => editing.save("card-1"));
    expect(editing.error).toBe("Both front and back are required.");

    act(() => editing.cancel());
    expect(editing.card).toBeNull();
    expect(editing.error).toBeNull();
  });

  it("clears a removed image from the card and deletes its file once saved", async () => {
    const image = {
      storagePath: "users/user-1/cardImages/file-1/cell.png",
      width: 640,
      height: 480,
    };
    const imageCard: Card = { ...startingCard, backImage: image };
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Harness initial={[imageCard]} />));

    act(() => editing.start(imageCard));
    expect(editing.draft.backImage).toEqual({ kind: "saved", image });
    act(() => editing.rows.updateDraft({ backImage: undefined }));
    await act(async () => editing.save("card-1"));

    // The text still answers the card, so the image can go.
    expect(mocks.updateCardContent).toHaveBeenCalledWith("card-1", {
      front: "Question",
      back: "Answer",
      topicIds: ["topic-1"],
      backImage: null,
    });
    expect(storageMocks.deleteStorageFile).toHaveBeenCalledWith(image.storagePath);
    expect(renderedCards[0].backImage).toBeUndefined();
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
