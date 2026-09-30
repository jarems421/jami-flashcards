import { describe, expect, it } from "vitest";
import type { CardImage } from "@/lib/study/card-images";
import type { Card } from "@/lib/study/cards";
import type { OcclusionDiagram, OcclusionLabel } from "@/lib/study/image-occlusion";
import { classifyStudyTask } from "@/lib/study/learning-task";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import {
  buildDeterministicExercise,
  getClassicEligibility,
  getGapFillEligibility,
  getMultipleChoiceEligibility,
  getTypeAnswerEligibility,
  needsStudyAssetPreparation,
} from "@/lib/study/mode-eligibility";
import { getCardContentHash } from "@/lib/study/study-modes";
import {
  createDiagramEditorState,
  diagramEditorReducer,
  type DiagramEditorState,
} from "@/lib/study/image-occlusion-editor";

const IMAGE: CardImage = { storagePath: "users/u/cardImages/f/heart.png", width: 1000, height: 800 };

function label(id: string, answer: string, x = 0.1): OcclusionLabel {
  return { id, answer, shapes: [{ kind: "rect", x, y: 0.1, width: 0.1, height: 0.05 }] };
}

const HEART: OcclusionDiagram = {
  id: "heart",
  image: IMAGE,
  labelMode: "cover",
  hideOthers: true,
  labels: [
    label("a", "Aorta"),
    label("b", "Left atrium", 0.3),
    label("c", "Right atrium", 0.5),
    label("d", "Left ventricle", 0.7),
    label("e", "Right ventricle", 0.8),
  ],
};

function card(labelId: string, diagram = HEART): Card {
  return {
    id: `card-${labelId}`,
    deckId: "deck",
    userId: "u",
    front: "",
    back: diagram.labels.find((entry) => entry.id === labelId)?.answer ?? "",
    tags: [],
    createdAt: 1,
    occlusion: { diagram, labelId },
  };
}

describe("studying a diagram label", () => {
  it("flips even when the label has no words, because the picture shows it", () => {
    const unnamed = { ...HEART, labels: [label("x", ""), ...HEART.labels] };
    expect(getClassicEligibility(card("x", unnamed))).toEqual({ eligible: true });
    expect(getTypeAnswerEligibility(card("x", unnamed))).toEqual({ eligible: false, reason: "empty-card" });
  });

  it("can be typed, with the diagram as the question", () => {
    expect(getTypeAnswerEligibility(card("b"))).toEqual({ eligible: true });
    const exercise = buildDeterministicExercise(card("b"), "type-answer", "hash");
    expect(exercise).toMatchObject({ mode: "type-answer", expectedAnswer: "Left atrium" });
  });

  it("is never gap-filled: a label is too short to leave a gap in", () => {
    expect(getGapFillEligibility(card("b"))).toEqual({ eligible: false, reason: "diagram-label" });
  });

  it("asks multiple choice from the diagram's other labels", () => {
    expect(getMultipleChoiceEligibility(card("b"))).toEqual({ eligible: true });
    const question = buildMultipleChoiceQuestion({ card: card("b"), seed: 7 });
    expect(question?.options).toHaveLength(4);
    const texts = question!.options.map((option) => option.text);
    expect(texts).toContain("Left atrium");
    for (const text of texts) {
      expect(HEART.labels.map((entry) => entry.answer)).toContain(text);
    }
    // Two-word options for a two-word answer, not the one-word "Aorta".
    expect(texts).not.toContain("Aorta");
  });

  it("refuses multiple choice when there are too few other labels to choose from", () => {
    const small = { ...HEART, labels: HEART.labels.slice(0, 3) };
    expect(getMultipleChoiceEligibility(card("b", small))).toEqual({ eligible: false, reason: "too-few-labels" });
  });

  it("is never sent for AI preparation: its questions come from the diagram", () => {
    expect(needsStudyAssetPreparation(card("b"), { kind: "smart" })).toBe(false);
    expect(needsStudyAssetPreparation(card("b"), { kind: "fixed", mode: "multiple-choice" })).toBe(false);
  });

  it("is treated as a term to name", () => {
    expect(classifyStudyTask(card("b"))).toMatchObject({ task: "term", preferredModes: ["type-answer"] });
  });

  it("goes stale when a neighbouring box changes, since its wrong options and mask do", () => {
    const moved = {
      ...HEART,
      labels: HEART.labels.map((entry) => (entry.id === "d" ? label("d", "Left ventricle", 0.75) : entry)),
    };
    expect(getCardContentHash(card("b"))).not.toBe(getCardContentHash(card("b", moved)));
  });

  it("leaves a card without a diagram with the fingerprint it always had", () => {
    const plain = { front: "Q", back: "A" };
    expect(getCardContentHash({ ...plain, occlusion: undefined })).toBe(getCardContentHash(plain));
  });
});

describe("the diagram editor's history", () => {
  const box = { kind: "rect" as const, x: 0.1, y: 0.1, width: 0.2, height: 0.1 };
  const start = () =>
    diagramEditorReducer(createDiagramEditorState(), { type: "add-label", label: { id: "a", answer: "", shapes: [box] } });

  it("undoes and redoes a drawn box", () => {
    const drawn = start();
    const undone = diagramEditorReducer(drawn, { type: "undo" });
    expect(undone.present.labels).toEqual([]);
    expect(diagramEditorReducer(undone, { type: "redo" }).present).toEqual(drawn.present);
  });

  it("undoes a whole label's typing in one step", () => {
    let state: DiagramEditorState = start();
    for (const answer of ["A", "Ao", "Aor", "Aorta"]) {
      state = diagramEditorReducer(state, { type: "set-answer", labelId: "a", answer });
    }
    expect(state.present.labels[0].answer).toBe("Aorta");
    expect(diagramEditorReducer(state, { type: "undo" }).present.labels[0].answer).toBe("");
  });

  it("undoes a whole drag in one step, and two drags in two", () => {
    let state = start();
    for (const x of [0.2, 0.3, 0.4]) {
      state = diagramEditorReducer(state, { type: "update-shape", labelId: "a", shapeIndex: 0, shape: { ...box, x }, gestureId: "g1" });
    }
    state = diagramEditorReducer(state, { type: "update-shape", labelId: "a", shapeIndex: 0, shape: { ...box, x: 0.5 }, gestureId: "g2" });
    const once = diagramEditorReducer(state, { type: "undo" });
    expect(once.present.labels[0].shapes[0].x).toBe(0.4);
    expect(diagramEditorReducer(once, { type: "undo" }).present.labels[0].shapes[0].x).toBe(0.1);
  });

  it("removes a label with its last box", () => {
    const state = diagramEditorReducer(start(), { type: "remove-shape", labelId: "a", shapeIndex: 0 });
    expect(state.present.labels).toEqual([]);
  });

  it("keeps extra boxes on the same label, and removing one leaves the rest", () => {
    let state = diagramEditorReducer(start(), { type: "add-shape", labelId: "a", shape: { ...box, x: 0.6 } });
    expect(state.present.labels[0].shapes).toHaveLength(2);
    state = diagramEditorReducer(state, { type: "remove-shape", labelId: "a", shapeIndex: 0 });
    expect(state.present.labels[0].shapes).toEqual([{ ...box, x: 0.6 }]);
  });

  it("drops a note by clearing it", () => {
    let state = diagramEditorReducer(start(), { type: "set-note", labelId: "a", note: "Thickest wall" });
    expect(state.present.labels[0].note).toBe("Thickest wall");
    state = diagramEditorReducer(state, { type: "set-note", labelId: "a", note: "" });
    expect("note" in state.present.labels[0]).toBe(false);
  });

  it("clears redo once something new is done", () => {
    const undone = diagramEditorReducer(start(), { type: "undo" });
    const redrawn = diagramEditorReducer(undone, { type: "add-label", label: { id: "b", answer: "", shapes: [box] } });
    expect(redrawn.future).toEqual([]);
  });
});
