// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/study/cards";
import {
  describeLastMixUp,
  getMixUpLabels,
  getMixUpMasks,
  mixUpCardIds,
  summariseDeckMixUps,
  summariseDiagramConfusions,
  type DiagramConfusionEvent,
} from "@/lib/study/diagram-confusion";
import type { OcclusionDiagram, OcclusionLabel } from "@/lib/study/image-occlusion";

/**
 * Your mix-ups: the labels a student keeps giving for each other on a deck's
 * diagrams, read from review events that record only ids and times, and shown
 * side by side. Practice only -- nothing here reaches a schedule.
 */

const events = vi.hoisted(() => ({
  load: vi.fn(async (...args: [userId: string, cardIds: readonly string[]]): Promise<DiagramConfusionEvent[]> => {
    void args;
    return [];
  }),
}));

vi.mock("@/services/learning/flashcard-review-events", () => ({
  loadDiagramConfusionEvents: events.load,
}));
vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: vi.fn(async () => undefined),
  getStorageFileDownloadUrl: vi.fn(async (path: string) => `https://files.test/${path}`),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: vi.fn(async () => undefined),
}));

const { default: DiagramMixUpsSection } = await import("@/components/decks/diagram/DiagramMixUpsSection");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 24 * 60 * 60 * 1000;
const NOON = Date.UTC(2026, 9, 8, 12);

function label(id: string, answer: string, x: number, extra: Partial<OcclusionLabel> = {}): OcclusionLabel {
  return { id, answer, shapes: [{ kind: "rect", x, y: 0.1, width: 0.1, height: 0.05 }], ...extra };
}

const HEART: OcclusionDiagram = {
  id: "heart",
  image: { storagePath: "users/u/cardImages/f/heart.png", width: 1000, height: 800 },
  labelMode: "cover",
  hideOthers: true,
  labels: [
    label("t", "Tricuspid valve", 0.1),
    label("m", "Mitral valve", 0.3, { note: "Two cusps, on the left." }),
    label("p", "Pulmonary valve", 0.5),
    label("a", "Aortic valve", 0.7),
  ],
};

const BONES: OcclusionDiagram = {
  ...HEART,
  id: "bones",
  labels: [label("ileum", "Ileum", 0.1), label("ilium", "Ilium", 0.3)],
};

function card(diagram: OcclusionDiagram, labelId: string, extra: Partial<Card> = {}): Card {
  return {
    id: `${diagram.id}-${labelId}`,
    userId: "u",
    deckId: "d",
    front: diagram.id === "heart" ? "The heart" : "",
    back: diagram.labels.find((entry) => entry.id === labelId)?.answer ?? "",
    tags: [],
    createdAt: 1,
    reps: 3,
    occlusion: { diagram, labelId },
    ...extra,
  };
}

const HEART_CARDS = HEART.labels.map((entry) => card(HEART, entry.id));
const BONE_CARDS = BONES.labels.map((entry) => card(BONES, entry.id));

describe("gathering a deck's mix-ups", () => {
  it("counts a pair both ways round and remembers when it last happened", () => {
    const [pair] = summariseDiagramConfusions(HEART, HEART_CARDS, [
      { cardId: "heart-t", confusedWithLabelId: "m", reviewedAt: NOON - 3 * DAY },
      { cardId: "heart-m", confusedWithLabelId: "t", reviewedAt: NOON - DAY },
    ]);
    expect(pair).toEqual({ labelIds: ["m", "t"], names: ["Mitral valve", "Tricuspid valve"], count: 2, lastAt: NOON - DAY });
  });

  it("lists every diagram's pairs, most often first, then most recent, each with its diagram", () => {
    const mixUps = summariseDeckMixUps([...HEART_CARDS, ...BONE_CARDS], [
      { cardId: "bones-ileum", confusedWithLabelId: "ilium", reviewedAt: NOON - 5 * DAY },
      { cardId: "heart-p", confusedWithLabelId: "a", reviewedAt: NOON - DAY },
      { cardId: "heart-t", confusedWithLabelId: "m", reviewedAt: NOON - 2 * DAY },
      { cardId: "heart-m", confusedWithLabelId: "t", reviewedAt: NOON - 9 * DAY },
    ]);
    expect(mixUps.map((mixUp) => [mixUp.title, mixUp.names, mixUp.count])).toEqual([
      ["The heart", ["Mitral valve", "Tricuspid valve"], 2],
      ["The heart", ["Aortic valve", "Pulmonary valve"], 1],
      ["Diagram", ["Ileum", "Ilium"], 1],
    ]);
    expect(mixUps[0]?.diagram.id).toBe("heart");
  });

  it("asks only about cards that ask one label and have been answered", () => {
    const group = { ...card(HEART, "t"), id: "heart-group", occlusion: { diagram: HEART, groupId: "valves" } };
    const fresh = card(HEART, "p", { reps: 0 });
    const older = card(HEART, "a", { reps: undefined });
    expect(mixUpCardIds([group, fresh, older, card(HEART, "m", { reps: 9 }), { ...card(HEART, "t"), occlusion: undefined }])).toEqual([
      "heart-m",
      "heart-a",
    ]);
    expect(mixUpCardIds(HEART_CARDS, 2)).toHaveLength(2);
  });

  it("says when, in study days", () => {
    expect(describeLastMixUp(NOON - 60_000, NOON)).toBe("today");
    expect(describeLastMixUp(NOON - DAY, NOON)).toBe("yesterday");
    expect(describeLastMixUp(NOON - 4 * DAY, NOON)).toBe("4 days ago");
    expect(describeLastMixUp(NOON - 21 * DAY, NOON)).toBe("3 weeks ago");
    expect(describeLastMixUp(NOON - 90 * DAY, NOON)).toBe("3 months ago");
  });
});

describe("drawing a pair", () => {
  it("puts the pair in diagram order, and gives up on one whose label has gone", () => {
    expect(getMixUpLabels(HEART, ["t", "m"])?.map((entry) => entry.index)).toEqual([0, 1]);
    expect(getMixUpLabels(HEART, ["m", "t"])?.map((entry) => entry.label.id)).toEqual(["t", "m"]);
    expect(getMixUpLabels(HEART, ["m", "gone"])).toBeNull();
  });

  it("outlines the first in the asked colour and the other in the mix-up amber, the rest as printed", () => {
    expect(getMixUpMasks(HEART, ["m", "t"]).map((mask) => mask.look)).toEqual([
      "target-revealed",
      "other-confused",
      "other-shown",
      "other-shown",
    ]);
    expect(getMixUpMasks(HEART, ["m", "t"], new Set(["m"])).map((mask) => mask.look)).toEqual([
      "target-revealed",
      "target-hidden",
      "other-shown",
      "other-shown",
    ]);
  });
});

describe("Your mix-ups on the deck page", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    events.load.mockReset();
    events.load.mockResolvedValue([]);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const render = async (cards: Card[]) => {
    await act(async () => root.render(<DiagramMixUpsSection userId="u" cards={cards} />));
    await act(async () => {});
  };
  const button = (name: string) =>
    Array.from(document.body.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === name || element.getAttribute("aria-label") === name
    );
  const status = () => document.body.querySelector('[role="dialog"] [role="status"]')?.textContent;

  it("shows nothing, and asks nothing, for a deck with no studied diagram labels", async () => {
    await render(HEART_CARDS.map((entry) => ({ ...entry, reps: 0 })));
    expect(events.load).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });

  it("shows nothing until there is a mix-up to show", async () => {
    await render(HEART_CARDS);
    expect(events.load).toHaveBeenCalledWith("u", ["heart-t", "heart-m", "heart-p", "heart-a"]);
    expect(host.textContent).toBe("");
  });

  it("lists each pair with how often and when, and compares them side by side", async () => {
    events.load.mockResolvedValue([
      { cardId: "heart-t", confusedWithLabelId: "m", reviewedAt: NOON - DAY },
      { cardId: "heart-m", confusedWithLabelId: "t", reviewedAt: NOON - 3 * DAY },
      { cardId: "heart-t", confusedWithLabelId: "m", reviewedAt: NOON - 4 * DAY },
    ]);
    await render(HEART_CARDS);

    expect(host.textContent).toContain("Your mix-ups");
    expect(host.textContent).toContain("1 pair of labels to untangle");
    expect(host.textContent).toContain("3 times, last yesterday · The heart");

    await act(async () => button("Compare")?.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Tricuspid valve and Mitral valve");
    expect(dialog?.textContent).toContain("Two cusps, on the left.");
    expect(dialog?.textContent).toContain("Practice only: this does not change when cards are due.");

    // Only the pair can be tapped; the rest of the picture is context.
    expect(button("Cover label 1, Tricuspid valve")).toBeDefined();
    expect(button("Cover label 3, Pulmonary valve")).toBeUndefined();

    await act(async () => button("Cover both")?.click());
    expect(status()).toBe("Say which is which, then tap a box to check.");
    await act(async () => button("Uncover label 2")?.click());
    expect(status()).toBe("Tap the covered box to check it.");
    await act(async () => button("Show both")?.click());
    expect(status()).toBe("Look at where each one is, then cover them to check you can tell them apart.");
  });

  it("does not ask again when the page hands it the same cards anew", async () => {
    await render(HEART_CARDS);
    await render(HEART_CARDS.map((entry) => ({ ...entry })));
    expect(events.load).toHaveBeenCalledTimes(1);
  });
});
