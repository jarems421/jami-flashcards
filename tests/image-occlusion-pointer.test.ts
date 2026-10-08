import { describe, expect, it } from "vitest";
import {
  cleanDiagramLabels,
  describeOcclusionMask,
  getOcclusionPrompt,
  normalizeCardOcclusion,
  type OcclusionLabel,
  type OcclusionMaskLook,
} from "@/lib/study/image-occlusion";
import { cropLabels, getPointerLine } from "@/lib/study/image-occlusion-geometry";
import { createDiagramEditorState, diagramEditorReducer } from "@/lib/study/image-occlusion-editor";

const slot: OcclusionLabel = {
  id: "lv",
  answer: "Left ventricle",
  shapes: [{ kind: "rect", x: 0.75, y: 0.6, width: 0.2, height: 0.06 }],
  pointer: { x: 0.55, y: 0.65 },
};
const ring: OcclusionLabel = { ...slot, pointer: undefined };

const looks: OcclusionMaskLook[] = ["target-hidden", "target-revealed", "other-hidden", "other-shown"];
const draw = (mode: "cover" | "name", label: OcclusionLabel) =>
  looks.map((look) => describeOcclusionMask(mode, { label, look }));

describe("the line from a label to its part", () => {
  it("starts on the edge of a box facing the tip", () => {
    // A box on the right, pointing left: the line leaves its left edge.
    const line = getPointerLine(slot.shapes[0], slot.pointer!, 1000, 800);
    expect(line).toEqual({ x1: 0.75, y1: 0.65, x2: 0.55, y2: 0.65 });
  });

  it("starts on an oval's edge in pixels, so it meets a stretched oval exactly", () => {
    const oval = { kind: "ellipse" as const, x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const line = getPointerLine(oval, { x: 0.9, y: 0.5 }, 1000, 500)!;
    // Straight out to the right: the oval's right edge.
    expect(line.x1).toBeCloseTo(0.6, 6);
    expect(line.y1).toBeCloseTo(0.5, 6);
  });

  it("draws no line when the tip is inside the box", () => {
    expect(getPointerLine(slot.shapes[0], { x: 0.8, y: 0.62 }, 1000, 800)).toBeNull();
    const oval = { kind: "ellipse" as const, x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    expect(getPointerLine(oval, { x: 0.5, y: 0.5 }, 1000, 800)).toBeNull();
  });
});

describe("how a label with a line is studied", () => {
  it("makes a named part with a line a label slot: asked blank, then the name written inside", () => {
    expect(draw("name", slot)).toEqual([
      { box: "cover-asked", inside: null, beside: null, pointer: "asked" },
      { box: "slot-asked", inside: "answer", beside: null, pointer: "asked" },
      // Hide all: the others are blank labels, each still pointing at its part.
      { box: "slot", inside: null, beside: null, pointer: "other" },
      { box: "slot", inside: "answer", beside: null, pointer: "other" },
    ]);
  });

  it("keeps a named part without a line as a ring with its name beside it", () => {
    expect(draw("name", ring).map((drawing) => [drawing.box, drawing.beside, drawing.pointer])).toEqual([
      ["outline-asked", null, null],
      ["outline-asked", "answer", null],
      [null, null, null],
      ["outline", "answer", null],
    ]);
  });

  it("asks what the line points to, when the label points by a line", () => {
    const diagram = {
      id: "d",
      image: { storagePath: "users/u/cardImages/f/x.png", width: 1000, height: 800 },
      labelMode: "name" as const,
      hideOthers: true,
      labels: [slot, { ...ring, id: "r" }],
    };
    expect(getOcclusionPrompt({ diagram, labelId: "lv" }, "")).toBe("What does the line point to?");
    expect(getOcclusionPrompt({ diagram, labelId: "r" }, "")).toBe("Name the outlined part.");
  });

  it("draws a covered label's line only while its box is drawn", () => {
    expect(draw("cover", slot).map((drawing) => drawing.pointer)).toEqual(["asked", "asked", "other", null]);
  });
});

describe("keeping lines", () => {
  const diagram = {
    id: "d",
    image: { storagePath: "users/u/cardImages/f/x.png", width: 1000, height: 800 },
    labelMode: "name",
    hideOthers: true,
    labels: [slot],
  };

  it("reads a stored line, kept on the picture", () => {
    const stored = { ...diagram, labels: [{ ...slot, pointer: { x: 1.4, y: 0.3 } }] };
    expect(normalizeCardOcclusion({ diagram: stored, labelId: "lv" }, "u")?.diagram.labels[0].pointer).toEqual({ x: 1, y: 0.3 });
  });

  it("ignores a malformed line and keeps the label", () => {
    const stored = { ...diagram, labels: [{ ...slot, pointer: { x: "left" } }] };
    const label = normalizeCardOcclusion({ diagram: stored, labelId: "lv" }, "u")?.diagram.labels[0];
    expect(label?.answer).toBe("Left ventricle");
    expect(label && "pointer" in label).toBe(false);
  });

  it("saves the line", () => {
    expect(cleanDiagramLabels([slot])[0].pointer).toEqual({ x: 0.55, y: 0.65 });
  });

  it("moves the line with a crop, and drops it when its tip is cropped away", () => {
    const [kept] = cropLabels([slot], { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(kept.pointer).toEqual({ x: 0.1, y: 0.3 });
    const [lost] = cropLabels([slot], { x: 0.7, y: 0.5, width: 0.3, height: 0.5 });
    expect(lost.shapes).toHaveLength(1);
    expect(lost.pointer).toBeUndefined();
  });

  it("undoes a dragged tip in one step, and removing a line in another", () => {
    let state = createDiagramEditorState({ labels: [ring] });
    state = diagramEditorReducer(state, { type: "set-pointer", labelId: "lv", pointer: { x: 0.5, y: 0.5 } });
    for (const x of [0.45, 0.4, 0.35]) {
      state = diagramEditorReducer(state, { type: "set-pointer", labelId: "lv", pointer: { x, y: 0.5 }, gestureId: "tip" });
    }
    state = diagramEditorReducer(state, { type: "set-pointer", labelId: "lv", pointer: null });
    expect(state.present.labels[0].pointer).toBeUndefined();
    state = diagramEditorReducer(state, { type: "undo" });
    expect(state.present.labels[0].pointer).toEqual({ x: 0.35, y: 0.5 });
    state = diagramEditorReducer(state, { type: "undo" });
    expect(state.present.labels[0].pointer).toEqual({ x: 0.5, y: 0.5 });
  });
});
