import { describe, expect, it } from "vitest";
import type { CardImage } from "@/lib/study/card-images";
import { getCardDuplicateKey, mapCardData, type Card } from "@/lib/study/cards";
import {
  applyOcclusionUpdates,
  cleanDiagramLabels,
  getDiagramDistractorPool,
  getDiagramDraftError,
  getDiagramTargets,
  groupsForCardStyle,
  WHOLE_DIAGRAM_GROUP_ID,
  getOcclusionMasks,
  getOcclusionPrompt,
  getRevealedAnswerWords,
  getWalkthroughMasks,
  groupDiagramCards,
  mergeSavedDiagramCards,
  normalizeCardOcclusion,
  OCCLUSION_COVER_COLORS,
  occlusionCoverClass,
  planDiagramCleanup,
  planDiagramSave,
  type CardOcclusion,
  type OcclusionDiagram,
  type OcclusionLabel,
} from "@/lib/study/image-occlusion";
import {
  cropLabels,
  defaultShapeAt,
  findShapeAt,
  moveShape,
  resizeShape,
  shapeFromPoints,
} from "@/lib/study/image-occlusion-geometry";

const USER = "user-1";
const IMAGE: CardImage = { storagePath: `users/${USER}/cardImages/file-1/heart.png`, width: 1000, height: 800 };

function label(id: string, answer: string, x = 0.1, y = 0.1): OcclusionLabel {
  return { id, answer, shapes: [{ kind: "rect", x, y, width: 0.1, height: 0.05 }] };
}

function diagram(labels: OcclusionLabel[], overrides: Partial<OcclusionDiagram> = {}): OcclusionDiagram {
  return { id: "diagram-1", image: IMAGE, labelMode: "cover", hideOthers: true, labels, ...overrides };
}

function diagramCard(id: string, labelId: string, source: OcclusionDiagram, extra: Partial<Card> = {}): Card {
  const answer = source.labels.find((entry) => entry.id === labelId)?.answer ?? "";
  return {
    id,
    deckId: "deck-1",
    userId: USER,
    front: "",
    back: answer,
    tags: [],
    createdAt: 1,
    occlusion: { diagram: source, labelId },
    ...extra,
  };
}

const HEART = diagram([
  label("a", "Aorta", 0.4, 0.05),
  label("b", "Left atrium", 0.6, 0.3),
  label("c", "Right atrium", 0.2, 0.3),
  label("d", "Left ventricle", 0.6, 0.7),
]);

describe("reading a stored diagram", () => {
  it("keeps a well-formed diagram card", () => {
    const occlusion = normalizeCardOcclusion({ diagram: HEART, labelId: "b" }, USER);
    expect(occlusion?.labelId).toBe("b");
    expect(occlusion?.diagram.labels.map((entry) => entry.answer)).toEqual([
      "Aorta",
      "Left atrium",
      "Right atrium",
      "Left ventricle",
    ]);
  });

  it("refuses a picture outside the owner's own card images", () => {
    const foreign = { ...HEART, image: { ...IMAGE, storagePath: "users/someone-else/cardImages/x/y.png" } };
    expect(normalizeCardOcclusion({ diagram: foreign, labelId: "a" }, USER)).toBeUndefined();
  });

  it("refuses a picture with no known size, since boxes are laid out before it loads", () => {
    expect(normalizeCardOcclusion({ diagram: { ...HEART, image: { ...IMAGE, width: 0 } }, labelId: "a" }, USER)).toBeUndefined();
  });

  it("refuses a card whose label is not in its diagram", () => {
    expect(normalizeCardOcclusion({ diagram: HEART, labelId: "missing" }, USER)).toBeUndefined();
  });

  it("drops unusable labels, repeated ids and boxes off the picture", () => {
    const occlusion = normalizeCardOcclusion(
      {
        diagram: {
          ...HEART,
          labels: [
            { id: "a", answer: "  Aorta  ", shapes: [{ kind: "rect", x: 0.95, y: -0.2, width: 0.2, height: 0.1 }] },
            { id: "a", answer: "Duplicate", shapes: [{ kind: "rect", x: 0, y: 0, width: 0.1, height: 0.1 }] },
            { id: "b", answer: "No boxes", shapes: [] },
            { id: "c", answer: "Bad box", shapes: [{ kind: "rect", x: 0, y: 0, width: -1, height: 0.1 }] },
          ],
        },
        labelId: "a",
      },
      USER
    );
    expect(occlusion?.diagram.labels).toEqual([
      { id: "a", answer: "Aorta", shapes: [{ kind: "rect", x: 0.8, y: 0, width: 0.2, height: 0.1 }] },
    ]);
  });

  it("keeps a known cover colour and drops one it does not know", () => {
    expect(normalizeCardOcclusion({ diagram: { ...HEART, coverColor: "mint" }, labelId: "a" }, USER)?.diagram.coverColor).toBe("mint");
    expect(normalizeCardOcclusion({ diagram: { ...HEART, coverColor: "#ff0000" }, labelId: "a" }, USER)?.diagram).not.toHaveProperty("coverColor");
  });

  it("names every cover colour's class in full, so the stylesheet build keeps it", () => {
    for (const color of OCCLUSION_COVER_COLORS) expect(occlusionCoverClass(color)).toBe(`occlusion-cover--${color}`);
    expect(occlusionCoverClass(undefined)).toBe("");
    expect(occlusionCoverClass(null)).toBe("");
  });

  it("writes names under a turned card only when the picture does not print them", () => {
    const atria = { id: "g", name: "Atria", labelIds: ["b", "c"] };
    expect(getRevealedAnswerWords({ diagram: HEART, labelId: "b" })).toEqual([]);
    expect(getRevealedAnswerWords({ diagram: { ...HEART, groups: [atria] }, groupId: "g" })).toEqual([]);
    const named = { ...HEART, labelMode: "name" as const, groups: [atria] };
    expect(getRevealedAnswerWords({ diagram: named, labelId: "b" })).toEqual(["Left atrium"]);
    expect(getRevealedAnswerWords({ diagram: named, groupId: "g" })).toEqual(["Left atrium", "Right atrium"]);
  });

  it("reaches cards through mapCardData, and a malformed diagram leaves a plain card", () => {
    const card = mapCardData("card-1", { userId: USER, deckId: "deck-1", front: "", back: "Aorta", occlusion: { diagram: HEART, labelId: "a" } });
    expect(card.occlusion?.labelId).toBe("a");
    const broken = mapCardData("card-2", { userId: USER, deckId: "deck-1", front: "", back: "Aorta", occlusion: { labelId: "a" } });
    expect(broken.occlusion).toBeUndefined();
  });

  it("never calls two labels of a diagram duplicates, even with the same words", () => {
    const twins = diagram([label("l", "Atrium"), label("r", "Atrium", 0.6)]);
    expect(getCardDuplicateKey(diagramCard("1", "l", twins))).not.toBe(getCardDuplicateKey(diagramCard("2", "r", twins)));
  });
});

describe("what each box looks like", () => {
  const occlusion: CardOcclusion = { diagram: HEART, labelId: "b" };

  it("asks one label and hides the rest in 'hide all'", () => {
    expect(getOcclusionMasks(occlusion, "question").map((mask) => mask.look)).toEqual([
      "other-hidden",
      "target-hidden",
      "other-hidden",
      "other-hidden",
    ]);
  });

  it("reveals only the asked label on the answer side, like Anki's hide all, guess one", () => {
    expect(getOcclusionMasks(occlusion, "answer").map((mask) => mask.look)).toEqual([
      "other-hidden",
      "target-revealed",
      "other-hidden",
      "other-hidden",
    ]);
  });

  it("shows the others in 'hide one', and everything when unmasked", () => {
    const hideOne = { ...occlusion, diagram: { ...HEART, hideOthers: false } };
    expect(getOcclusionMasks(hideOne, "question").filter((mask) => mask.look === "other-shown")).toHaveLength(3);
    expect(getOcclusionMasks(occlusion, "unmasked").filter((mask) => mask.look === "other-shown")).toHaveLength(3);
  });

  it("lets multiple choice hide every other label whatever the diagram says", () => {
    const hideOne = { ...occlusion, diagram: { ...HEART, hideOthers: false } };
    expect(getOcclusionMasks(hideOne, "question", { hideOthers: true }).filter((mask) => mask.look === "other-hidden")).toHaveLength(3);
  });

  it("covers every label for going over a diagram by hand, and uncovers what was tapped", () => {
    const looks = getWalkthroughMasks(HEART, new Set(["c"])).map((mask) => mask.look);
    expect(looks).toEqual(["target-hidden", "target-hidden", "target-revealed", "target-hidden"]);
  });

  it("says what to do when the diagram has no question of its own", () => {
    expect(getOcclusionPrompt(occlusion, "")).toBe("What is under the highlighted box?");
    expect(getOcclusionPrompt({ ...occlusion, diagram: { ...HEART, labelMode: "name" } }, " ")).toBe("Name the outlined part.");
    expect(getOcclusionPrompt(occlusion, " The heart ")).toBe("The heart");
  });
});

describe("drawing", () => {
  it("makes the same box whichever way it is dragged", () => {
    expect(shapeFromPoints("rect", { x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ kind: "rect", x: 0.2, y: 0.1, width: 0.3, height: 0.5 });
  });

  it("drops a label-shaped box on a tap, kept inside the picture at the edges", () => {
    const shape = defaultShapeAt("rect", { x: 0.99, y: 0.01 }, 1000 / 800);
    expect(shape.x + shape.width).toBeLessThanOrEqual(1);
    expect(shape.y).toBe(0);
    // About three times as wide as tall on screen.
    expect((shape.width * 1000) / (shape.height * 800)).toBeCloseTo(3, 1);
  });

  it("moves a box but never off the picture", () => {
    const shape = { kind: "rect" as const, x: 0.8, y: 0.8, width: 0.1, height: 0.1 };
    expect(moveShape(shape, 0.5, 0.5)).toMatchObject({ x: 0.9, y: 0.9 });
  });

  it("resizes from a corner, keeping the opposite corner where it was", () => {
    const shape = { kind: "rect" as const, x: 0.2, y: 0.2, width: 0.2, height: 0.2 };
    expect(resizeShape(shape, "se", { x: 0.7, y: 0.5 })).toEqual({ kind: "rect", x: 0.2, y: 0.2, width: 0.5, height: 0.3 });
    // Dragged past the anchor, it flips rather than collapsing.
    expect(resizeShape(shape, "nw", { x: 0.5, y: 0.5 })).toEqual({ kind: "rect", x: 0.4, y: 0.4, width: 0.1, height: 0.1 });
  });

  it("finds the topmost box under a point, and an oval's corners are not in it", () => {
    const labels = [
      label("under", "Under", 0.1, 0.1),
      { id: "over", answer: "Over", shapes: [{ kind: "rect" as const, x: 0.12, y: 0.11, width: 0.1, height: 0.05 }] },
      { id: "oval", answer: "Oval", shapes: [{ kind: "ellipse" as const, x: 0.5, y: 0.5, width: 0.2, height: 0.2 }] },
    ];
    expect(findShapeAt(labels, { x: 0.15, y: 0.13 })).toEqual({ labelId: "over", shapeIndex: 0 });
    expect(findShapeAt(labels, { x: 0.6, y: 0.6 })).toEqual({ labelId: "oval", shapeIndex: 0 });
    expect(findShapeAt(labels, { x: 0.505, y: 0.505 })).toBeNull();
  });
});

describe("cropping", () => {
  it("moves boxes into the crop, cuts one at its edge, and drops one mostly outside", () => {
    const labels = [
      label("inside", "Inside", 0.3, 0.3),
      { id: "edge", answer: "Edge", shapes: [{ kind: "rect" as const, x: 0.43, y: 0.3, width: 0.1, height: 0.1 }] },
      { id: "outside", answer: "Outside", shapes: [{ kind: "rect" as const, x: 0.48, y: 0.3, width: 0.1, height: 0.1 }] },
    ];
    const cropped = cropLabels(labels, { x: 0.2, y: 0.2, width: 0.3, height: 0.5 });
    expect(cropped.map((entry) => entry.id)).toEqual(["inside", "edge"]);
    expect(cropped[0].shapes[0].x).toBeCloseTo(1 / 3, 3);
    expect(cropped[1].shapes[0].x + cropped[1].shapes[0].width).toBeCloseTo(1, 3);
  });
});

describe("saving", () => {
  it("needs at least one box", () => {
    expect(getDiagramDraftError({ labelMode: "cover", labels: [] })).toMatch(/at least one label/);
  });

  it("lets a covered label go unnamed, since the picture shows it", () => {
    expect(getDiagramDraftError({ labelMode: "cover", labels: [label("a", "")] })).toBeNull();
  });

  it("needs a name for every part when the picture has no labels", () => {
    expect(getDiagramDraftError({ labelMode: "name", labels: [label("a", "Aorta"), label("b", "  ")] })).toMatch(/Label 2 needs a name/);
  });

  it("stores labels trimmed, with empty notes left off", () => {
    expect(cleanDiagramLabels([{ ...label("a", "  Left   atrium "), note: "  " }])).toEqual([
      { id: "a", answer: "Left atrium", shapes: label("a", "").shapes },
    ]);
  });

  it("keeps each label's card, creates cards for new labels and removes cards whose label went", () => {
    const existing = [
      diagramCard("card-a", "a", HEART),
      diagramCard("card-b", "b", HEART),
      diagramCard("card-b2", "b", HEART),
      diagramCard("card-c", "c", HEART),
    ];
    const plan = planDiagramSave(existing, [{ labelId: "a" }, { labelId: "b" }, { labelId: "new" }]);
    expect(plan.keep).toEqual([
      { target: { labelId: "a" }, cardId: "card-a" },
      { target: { labelId: "b" }, cardId: "card-b" },
    ]);
    expect(plan.create).toEqual([{ labelId: "new" }]);
    expect(plan.remove).toEqual(["card-b2", "card-c"]);
  });
});

describe("after cards are deleted", () => {
  it("removes the deleted labels from the cards that remain", () => {
    const deleted = [diagramCard("card-b", "b", HEART)];
    const survivors = ["a", "c", "d"].map((labelId) => diagramCard(`card-${labelId}`, labelId, HEART));
    const plan = planDiagramCleanup(deleted, survivors);
    expect(plan.orphanedImages).toEqual([]);
    expect(plan.updates.map((update) => update.cardId)).toEqual(["card-a", "card-c", "card-d"]);
    expect(plan.updates[0].occlusion.diagram.labels.map((entry) => entry.id)).toEqual(["a", "c", "d"]);
  });

  it("frees the picture when no card of the diagram is left", () => {
    const deleted = ["a", "b"].map((labelId) => diagramCard(`card-${labelId}`, labelId, diagram([label("a", "A"), label("b", "B")])));
    expect(planDiagramCleanup(deleted, [])).toEqual({ updates: [], deletes: [], orphanedImages: [IMAGE] });
  });

  it("ignores cards that are not diagrams", () => {
    const plain: Card = { id: "plain", deckId: "deck-1", userId: USER, front: "Q", back: "A", tags: [], createdAt: 1 };
    expect(planDiagramCleanup([plain], [])).toEqual({ updates: [], deletes: [], orphanedImages: [] });
  });

  it("applies the changes to a page's cards", () => {
    const cards = [diagramCard("card-a", "a", HEART), diagramCard("card-c", "c", HEART)];
    const pruned: CardOcclusion = { diagram: { ...HEART, labels: HEART.labels.slice(0, 1) }, labelId: "a" };
    const updated = applyOcclusionUpdates(cards, [{ cardId: "card-a", occlusion: pruned }]);
    expect(updated[0].occlusion).toBe(pruned);
    expect(updated[1]).toBe(cards[1]);
  });
});

describe("lists", () => {
  it("merges a saved diagram into a page's cards", () => {
    const other: Card = { id: "other", deckId: "deck-1", userId: USER, front: "Q", back: "A", tags: [], createdAt: 1 };
    const kept = diagramCard("card-a", "a", HEART);
    const removed = diagramCard("card-b", "b", HEART);
    const savedKept = { ...kept, back: "Aorta (edited)" };
    const created = diagramCard("card-new", "d", HEART);
    const merged = mergeSavedDiagramCards([kept, other, removed], [savedKept, created], ["card-b"]);
    expect(merged.map((card) => card.id)).toEqual(["card-new", "card-a", "other"]);
    expect(merged[1].back).toBe("Aorta (edited)");
  });

  it("groups label cards by diagram in label order", () => {
    const cards = [diagramCard("3", "c", HEART), diagramCard("1", "a", HEART), diagramCard("2", "b", HEART)];
    const [group] = groupDiagramCards(cards);
    expect(group.cards.map((card) => card.id)).toEqual(["1", "2", "3"]);
  });

  it("offers the other named labels, once each, as wrong options", () => {
    const withBlanks = diagram([label("a", "Aorta"), label("b", ""), label("c", "aorta"), label("d", "Vena cava")]);
    expect(getDiagramDistractorPool({ diagram: withBlanks, labelId: "a" })).toEqual(["Vena cava"]);
  });
});

describe("one card for the whole diagram", () => {
  const WHOLE = diagram(HEART.labels, {
    cardStyle: "whole",
    groups: [{ id: WHOLE_DIAGRAM_GROUP_ID, name: "", labelIds: HEART.labels.map((entry) => entry.id) }],
  });

  it("asks every label on one card, and a card per label when split", () => {
    expect(getDiagramTargets(WHOLE)).toEqual([{ groupId: WHOLE_DIAGRAM_GROUP_ID }]);
    expect(getDiagramTargets({ ...WHOLE, cardStyle: "each", groups: [] })).toHaveLength(4);
    // A single label is its own card either way.
    expect(getDiagramTargets(diagram([label("a", "Aorta")], { cardStyle: "whole" }))).toEqual([{ labelId: "a" }]);
  });

  it("stores the whole-diagram group only for a whole diagram, and drops other groups with it", () => {
    const valves = { id: "valves", name: "Valves", labelIds: ["a", "b"] };
    expect(groupsForCardStyle({ labels: HEART.labels, groups: [valves], cardStyle: "whole" })).toEqual([
      { id: WHOLE_DIAGRAM_GROUP_ID, name: "", labelIds: ["a", "b", "c", "d"] },
    ]);
    expect(
      groupsForCardStyle({ labels: HEART.labels, groups: [valves, ...(WHOLE.groups ?? [])], cardStyle: "each" })
    ).toEqual([valves]);
  });

  it("switching style replaces the cards", () => {
    const perLabel = HEART.labels.map((entry) => diagramCard(`card-${entry.id}`, entry.id, HEART));
    const plan = planDiagramSave(perLabel, getDiagramTargets(WHOLE));
    expect(plan.keep).toEqual([]);
    expect(plan.create).toEqual([{ groupId: WHOLE_DIAGRAM_GROUP_ID }]);
    expect(plan.remove).toEqual(["card-a", "card-b", "card-c", "card-d"]);
  });

  it("asks for every label, without counting them into a highlighted set", () => {
    const occlusion: CardOcclusion = { diagram: WHOLE, groupId: WHOLE_DIAGRAM_GROUP_ID };
    expect(getOcclusionPrompt(occlusion, "")).toBe("Name every covered label.");
    expect(getOcclusionPrompt(occlusion, "The heart")).toBe("The heart: name every covered label.");
    expect(normalizeCardOcclusion({ diagram: WHOLE, groupId: WHOLE_DIAGRAM_GROUP_ID }, USER)?.diagram.cardStyle).toBe("whole");
  });

  it("keeps its labels when an unrelated card of the same diagram is deleted", () => {
    const wholeCard: Card = { ...diagramCard("card-whole", "a", WHOLE), occlusion: { diagram: WHOLE, groupId: WHOLE_DIAGRAM_GROUP_ID } };
    const stray = diagramCard("card-stray", "a", WHOLE);
    const plan = planDiagramCleanup([stray], [wholeCard]);
    expect(plan.deletes).toEqual([]);
    expect(plan.orphanedImages).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it("colours every box by the one card's strength", async () => {
    const { getDiagramStrengths } = await import("@/lib/study/diagram-strength");
    const wholeCard: Card = { ...diagramCard("card-whole", "a", WHOLE), occlusion: { diagram: WHOLE, groupId: WHOLE_DIAGRAM_GROUP_ID } };
    const strengths = getDiagramStrengths([wholeCard]);
    expect([...strengths.keys()]).toEqual(["a", "b", "c", "d"]);
    expect(new Set(strengths.values()).size).toBe(1);
  });
});
