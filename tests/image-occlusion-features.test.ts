import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardImage } from "@/lib/study/card-images";
import { getCardAcceptedAnswers, getCardDuplicateKey, getCardMarkingSettings, mapCardData, type Card } from "@/lib/study/cards";
import { CARD_STRENGTH_TINT_CLASSES, getCardStrength } from "@/lib/study/card-strength";
import { findConfusedLabel, summariseDiagramConfusions } from "@/lib/study/diagram-confusion";
import { labelsFromDetections, parseDetectedLabels } from "@/lib/study/diagram-label-detection";
import {
  cleanAcceptedAnswers,
  cropLabels,
  getDiagramDistractorPool,
  getDiagramDraftError,
  getOcclusionMasks,
  getOcclusionPrompt,
  getPointerLine,
  normalizeCardOcclusion,
  planDiagramCleanup,
  planDiagramSave,
  polygonShapeFromPath,
  resizeShape,
  shapeContainsPoint,
  type OcclusionDiagram,
  type OcclusionLabel,
  type OcclusionShape,
} from "@/lib/study/image-occlusion";
import { createDiagramEditorState, diagramEditorReducer } from "@/lib/study/image-occlusion-editor";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import { getClassicEligibility, getMultipleChoiceEligibility, getTypeAnswerEligibility } from "@/lib/study/mode-eligibility";
import { markTypedAnswer } from "@/lib/study/answer-marking";
import { buildFlashcardReviewEventWrite, decodeFlashcardReviewEvent } from "@/lib/learning/events/flashcard-review-event";

const USER = "u";
const IMAGE: CardImage = { storagePath: `users/${USER}/cardImages/f/heart.png`, width: 1000, height: 800 };

function label(id: string, answer: string, x = 0.1, extra: Partial<OcclusionLabel> = {}): OcclusionLabel {
  return { id, answer, shapes: [{ kind: "rect", x, y: 0.1, width: 0.1, height: 0.05 }], ...extra };
}

const VALVES: OcclusionDiagram = {
  id: "heart",
  image: IMAGE,
  labelMode: "cover",
  hideOthers: true,
  labels: [
    label("t", "Tricuspid valve", 0.1),
    label("m", "Mitral valve", 0.3, { accepts: ["Bicuspid valve"] }),
    label("p", "Pulmonary valve", 0.5),
    label("a", "Aortic valve", 0.7),
    label("x", "Aorta", 0.85),
  ],
  groups: [{ id: "valves", name: "The four valves", labelIds: ["t", "m", "p", "a"] }],
};

function card(target: { labelId: string } | { groupId: string }, diagram = VALVES, extra: Partial<Card> = {}): Card {
  const occlusion = "groupId" in target ? { diagram, groupId: target.groupId } : { diagram, labelId: target.labelId };
  const back = "labelId" in target ? diagram.labels.find((entry) => entry.id === target.labelId)!.answer : "";
  return { id: `card-${"groupId" in target ? target.groupId : target.labelId}`, deckId: "d", userId: USER, front: "", back, tags: [], createdAt: 1, occlusion, ...extra };
}

describe("labels asked together", () => {
  it("reads a group card, and refuses one naming a group the diagram lacks", () => {
    expect(normalizeCardOcclusion({ diagram: VALVES, groupId: "valves" }, USER)?.groupId).toBe("valves");
    expect(normalizeCardOcclusion({ diagram: VALVES, groupId: "nope" }, USER)).toBeUndefined();
  });

  it("drops a group's unknown labels when reading, and a group left empty", () => {
    const diagram = { ...VALVES, groups: [{ id: "g1", name: "", labelIds: ["t", "ghost"] }, { id: "g2", name: "", labelIds: ["ghost"] }] };
    const read = normalizeCardOcclusion({ diagram, labelId: "t" }, USER);
    expect(read?.diagram.groups).toEqual([{ id: "g1", name: "", labelIds: ["t"] }]);
  });

  it("covers every label of the group while asking, and uncovers them all on the answer", () => {
    const occlusion = card({ groupId: "valves" }).occlusion!;
    expect(getOcclusionMasks(occlusion, "question").filter((mask) => mask.look === "target-hidden")).toHaveLength(4);
    expect(getOcclusionMasks(occlusion, "answer").filter((mask) => mask.look === "target-revealed")).toHaveLength(4);
  });

  it("says how many labels to name, with the group's name", () => {
    expect(getOcclusionPrompt(card({ groupId: "valves" }).occlusion!, "")).toBe("The four valves: name the 4 highlighted labels.");
  });

  it("is only ever flipped", () => {
    const group = card({ groupId: "valves" }, VALVES, { back: "Tricuspid valve; Mitral valve; Pulmonary valve; Aortic valve" });
    expect(getClassicEligibility(group)).toEqual({ eligible: true });
    expect(getTypeAnswerEligibility(group)).toEqual({ eligible: false, reason: "diagram-group" });
    expect(getMultipleChoiceEligibility(group)).toEqual({ eligible: false, reason: "diagram-group" });
  });

  it("keys a group card apart from its labels", () => {
    expect(getCardDuplicateKey(card({ groupId: "valves" }))).not.toBe(getCardDuplicateKey(card({ labelId: "t" })));
  });

  it("gives a group its own card, kept across saves", () => {
    const existing = [card({ labelId: "t" }), card({ groupId: "valves" })];
    const plan = planDiagramSave(existing, [{ labelId: "t" }, { labelId: "m" }, { groupId: "valves" }]);
    expect(plan.keep.map((entry) => entry.cardId)).toEqual(["card-t", "card-valves"]);
    expect(plan.create).toEqual([{ labelId: "m" }]);
  });

  it("needs two labels or more to be saved", () => {
    const groups = [{ id: "g", name: "", labelIds: ["t"] }];
    expect(getDiagramDraftError({ labelMode: "cover", labels: VALVES.labels, groups })).toMatch(/at least two labels/);
  });

  it("loses a deleted label, and goes when none of its labels are left", () => {
    const survivors = [card({ labelId: "x" }), card({ groupId: "valves" })];
    const deleted = ["t", "m", "p", "a"].map((labelId) => card({ labelId }));
    const plan = planDiagramCleanup(deleted, survivors);
    expect(plan.deletes).toEqual(["card-valves"]);
    expect(plan.updates.map((update) => update.cardId)).toEqual(["card-x"]);
    expect(plan.updates[0].occlusion.diagram.groups).toBeUndefined();
    expect(plan.orphanedImages).toEqual([]);
  });

  it("is edited with its labels: removing a label takes it out of every group", () => {
    let state = createDiagramEditorState({ labels: VALVES.labels, groups: VALVES.groups });
    state = diagramEditorReducer(state, { type: "remove-label", labelId: "t" });
    expect(state.present.groups[0].labelIds).toEqual(["m", "p", "a"]);
    state = diagramEditorReducer(state, { type: "toggle-group-label", groupId: "valves", labelId: "x" });
    expect(state.present.groups[0].labelIds).toContain("x");
    state = diagramEditorReducer(state, { type: "undo" });
    expect(state.present.groups[0].labelIds).not.toContain("x");
  });
});

describe("outlines traced by hand", () => {
  const path = Array.from({ length: 40 }, (_, index) => {
    const angle = (index / 40) * Math.PI * 2;
    return { x: 0.5 + 0.2 * Math.cos(angle), y: 0.5 + 0.15 * Math.sin(angle) };
  });

  it("become an outline with its corners relative to its own box", () => {
    const shape = polygonShapeFromPath(path, 1.25)!;
    expect(shape.kind).toBe("polygon");
    expect(shape.x).toBeCloseTo(0.3, 2);
    expect(shape.width).toBeCloseTo(0.4, 2);
    expect(shape.points!.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
    expect(shape.points!.length).toBeGreaterThanOrEqual(8);
  });

  it("refuses a scribble too small to enclose anything", () => {
    expect(polygonShapeFromPath([{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }, { x: 0.5, y: 0.501 }], 1)).toBeNull();
  });

  it("contains points inside the traced line only", () => {
    const shape = polygonShapeFromPath(path, 1)!;
    expect(shapeContainsPoint(shape, { x: 0.5, y: 0.5 })).toBe(true);
    // Inside the box, outside the oval traced in it.
    expect(shapeContainsPoint(shape, { x: 0.31, y: 0.36 })).toBe(false);
  });

  it("stretches with its box when resized", () => {
    const shape = polygonShapeFromPath(path, 1)!;
    const resized = resizeShape(shape, "se", { x: 0.9, y: 0.9 });
    expect(resized.points).toEqual(shape.points);
    expect(resized.width).toBeGreaterThan(shape.width);
  });

  it("starts a line on its own edge, not its box's", () => {
    const shape = polygonShapeFromPath(path, 1)!;
    const line = getPointerLine(shape, { x: 0.95, y: 0.5 }, 1000, 1000)!;
    expect(line.x1).toBeCloseTo(0.7, 2);
  });

  it("is read back only with three corners or more", () => {
    const stored = (shape: Partial<OcclusionShape>) =>
      normalizeCardOcclusion({ diagram: { ...VALVES, labels: [{ id: "o", answer: "", shapes: [{ kind: "polygon", x: 0.1, y: 0.1, width: 0.2, height: 0.2, ...shape }] }], groups: [] }, labelId: "o" }, USER);
    expect(stored({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] })?.diagram.labels[0].shapes[0].points).toHaveLength(3);
    expect(stored({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })).toBeUndefined();
  });

  it("is carried through a crop", () => {
    const shape = polygonShapeFromPath(path, 1)!;
    const [cropped] = cropLabels([{ id: "o", answer: "", shapes: [shape] }], { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(cropped.shapes[0].kind).toBe("polygon");
    expect(cropped.shapes[0].x).toBeCloseTo(0.1, 2);
  });
});

describe("bent lines", () => {
  const box: OcclusionShape = { kind: "rect", x: 0.7, y: 0.1, width: 0.2, height: 0.06 };

  it("leave the box heading for the bend, then go on to the tip", () => {
    const line = getPointerLine(box, { x: 0.3, y: 0.6, bend: { x: 0.8, y: 0.5 } }, 1000, 800)!;
    // Straight down out of the bottom edge towards the bend, not sideways towards the tip.
    expect(line.x1).toBeCloseTo(0.8, 5);
    expect(line.y1).toBeCloseTo(0.16, 5);
    expect(line.bend).toEqual({ x: 0.8, y: 0.5 });
  });

  it("straighten when a crop cuts their bend off", () => {
    const [kept] = cropLabels([{ id: "l", answer: "", shapes: [box], pointer: { x: 0.75, y: 0.5, bend: { x: 0.2, y: 0.3 } } }], { x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(kept.pointer).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("other accepted answers", () => {
  it("are cleaned: trimmed, once each, never the answer again", () => {
    expect(cleanAcceptedAnswers([" LV ", "lv", "Left ventricle", "", 3], "Left ventricle")).toEqual(["LV"]);
  });

  it("mark a typed answer right", () => {
    const mitral = card({ labelId: "m" });
    const result = markTypedAnswer({ response: "bicuspid valve", expectedAnswer: mitral.back, settings: getCardMarkingSettings(mitral) });
    expect(result.verdict).toBe("correct");
    expect(getCardAcceptedAnswers(mitral)).toEqual(["Bicuspid valve"]);
  });

  it("are never offered as a wrong option", () => {
    const withAlias = { ...VALVES, labels: [...VALVES.labels, label("b", "Bicuspid valve", 0.9)] };
    expect(getDiagramDistractorPool({ diagram: withAlias, labelId: "m" })).not.toContain("Bicuspid valve");
    const question = buildMultipleChoiceQuestion({ card: card({ labelId: "m" }, withAlias), seed: 1 });
    expect(question?.options.map((option) => option.text)).not.toContain("Bicuspid valve");
  });

  it("survive being stored", () => {
    const stored = mapCardData("c", { userId: USER, front: "", back: "Mitral valve", occlusion: { diagram: VALVES, labelId: "m" } });
    expect(stored.occlusion?.diagram.labels[1].accepts).toEqual(["Bicuspid valve"]);
  });
});

describe("mix-ups between neighbours", () => {
  it("find the neighbour a wrong answer named, by its words or its alternatives", () => {
    const tricuspid = card({ labelId: "t" }).occlusion!;
    expect(findConfusedLabel(tricuspid, "mitral valve")).toBe("m");
    expect(findConfusedLabel(tricuspid, "Bicuspid valve")).toBe("m");
    expect(findConfusedLabel(tricuspid, "tricuspid valve")).toBeNull();
    expect(findConfusedLabel(tricuspid, "the left kidney")).toBeNull();
  });

  it("find a neighbour one letter away that spelling tolerance alone would let through", () => {
    // Ileum and ilium are a letter apart. Marked against the ileum, "ilium" is
    // only a close spelling, which is why the study card checks for a named
    // neighbour on anything short of correct, not just on wrong answers.
    const bones: OcclusionDiagram = {
      ...VALVES,
      labels: [
        { id: "ileum", answer: "Ileum", shapes: VALVES.labels[0].shapes },
        { id: "ilium", answer: "Ilium", shapes: VALVES.labels[1].shapes },
      ],
    };
    expect(markTypedAnswer({ response: "ilium", expectedAnswer: "Ileum" }).verdict).toBe("close");
    expect(findConfusedLabel({ diagram: bones, labelId: "ileum" }, "ilium")).toBe("ilium");
  });

  it("show the neighbour on the answer side only", () => {
    const tricuspid = card({ labelId: "t" }).occlusion!;
    expect(getOcclusionMasks(tricuspid, "question", { confusedLabelId: "m" })[1].look).toBe("other-hidden");
    expect(getOcclusionMasks(tricuspid, "answer", { confusedLabelId: "m" })[1].look).toBe("other-confused");
  });

  it("count a pair both ways round, most often first", () => {
    const cards = [card({ labelId: "t" }), card({ labelId: "m" }), card({ labelId: "p" })];
    const pairs = summariseDiagramConfusions(VALVES, cards, [
      { cardId: "card-t", confusedWithLabelId: "m" },
      { cardId: "card-m", confusedWithLabelId: "t" },
      { cardId: "card-p", confusedWithLabelId: "a" },
      { cardId: "card-t", confusedWithLabelId: "t" },
    ]);
    expect(pairs.map((pair) => [pair.names, pair.count])).toEqual([
      [["Mitral valve", "Tricuspid valve"], 2],
      [["Aortic valve", "Pulmonary valve"], 1],
    ]);
  });

  it("are recorded as an id, and only on a wrong answer", () => {
    const review = {
      cardId: "card-t",
      deckId: "d",
      reviewedAt: Date.UTC(2026, 8, 30),
      studyDayKey: "2026-09-30",
      isCorrect: false,
      rating: "again" as const,
      sessionKind: "daily-required" as const,
      confusedWithLabelId: "m",
    };
    expect(buildFlashcardReviewEventWrite(review, 1)).toMatchObject({ confusedWithLabelId: "m" });
    expect(buildFlashcardReviewEventWrite({ ...review, isCorrect: true, rating: "good" }, 1)).not.toHaveProperty("confusedWithLabelId");
    const write = buildFlashcardReviewEventWrite(review, 1)!;
    expect(decodeFlashcardReviewEvent("e", write)?.confusedWithLabelId).toBe("m");
  });
});

describe("how well each label is known", () => {
  it("never calls an unstudied label weak", () => {
    expect(getCardStrength({ reps: 0 })).toBe("new");
  });

  it("reads a steady card as strong and a struggling one as needing focus", () => {
    const now = Date.UTC(2026, 8, 30);
    expect(getCardStrength({ reps: 8, lapses: 0, difficulty: 3, scheduledDays: 30, dueDate: now + 20 * 86_400_000, lastReview: now - 10 * 86_400_000 }, now)).toBe("strong");
    expect(getCardStrength({ reps: 6, lapses: 4, difficulty: 9, scheduledDays: 1, dueDate: now - 5 * 86_400_000, lastReview: now - 6 * 86_400_000, lastStruggleAt: now - 6 * 86_400_000 }, now)).toBe("needs-focus");
  });

  /*
   * Tailwind keeps a rule only when it finds the class written out whole in
   * the source. The colours once went missing because the class was built
   * from a template; the map spells each one out, and each needs its rule.
   */
  it("has a colour rule for every strength", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    for (const className of Object.values(CARD_STRENGTH_TINT_CLASSES)) {
      expect(css).toContain(`.${className} {`);
    }
  });
});

describe("finding printed labels", () => {
  it("reads boxes in thousandths, pads them, and tidies the words", () => {
    const labels = parseDetectedLabels(
      JSON.stringify({ labels: [{ text: " 1. Aorta ", box_2d: [100, 600, 150, 700] }, { text: "3rd ventricle", box_2d: [300, 100, 340, 250] }] })
    );
    expect(labels.map((entry) => entry.text)).toEqual(["Aorta", "3rd ventricle"]);
    expect(labels[0].x).toBeCloseTo(0.594, 3);
    expect(labels[0].width).toBeCloseTo(0.112, 3);
  });

  it("ignores what is not a label: bad boxes, captions and repeats", () => {
    const labels = parseDetectedLabels(`Here you go: {"labels": [
      {"text": "Aorta", "box_2d": [100, 600, 150, 700]},
      {"text": "Aorta", "box_2d": [101, 601, 151, 699]},
      {"text": "Backwards", "box_2d": [150, 700, 100, 600]},
      {"text": "Figure 3: the human heart seen from the front with every chamber shown", "box_2d": [900, 0, 950, 1000]},
      {"text": "Caption panel", "box_2d": [0, 0, 600, 600]},
      {"text": "", "box_2d": [1, 1, 2, 2]},
      {"text": "Left atrium", "box_2d": ["a", 1, 2, 3]}
    ]}`);
    expect(labels.map((entry) => entry.text)).toEqual(["Aorta"]);
    expect(parseDetectedLabels("not json")).toEqual([]);
  });

  it("never boxes a word the student already covered", () => {
    let id = 0;
    const found = parseDetectedLabels(
      JSON.stringify({ labels: [{ text: "Aorta", box_2d: [100, 100, 150, 200] }, { text: "Vena cava", box_2d: [500, 500, 550, 650] }] })
    );
    const existing = [label("mine", "", 0.1, { shapes: [{ kind: "rect", x: 0.09, y: 0.09, width: 0.13, height: 0.08 }] })];
    const labels = labelsFromDetections(found, existing, () => `new-${(id += 1)}`);
    expect(labels.map((entry) => entry.answer)).toEqual(["Vena cava"]);
  });
});
