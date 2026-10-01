import { normalizeCardImage, type CardImage } from "@/lib/study/card-images";

/**
 * Image occlusion: diagram cards, one card per label.
 *
 * A student adds a picture -- a heart, a cell, a map -- and draws a box over
 * each label they want to learn. Every label becomes its own card with its own
 * schedule, so "tricuspid valve" keeps coming back long after "aorta" has
 * settled. Anki calls the same idea "Hide all, guess one"; the shape here
 * follows it loosely. A group of labels can also be asked together as one
 * more card ("name all four valves").
 *
 * Every card of a diagram carries the whole diagram, not a reference to it.
 * Each card then renders itself -- in a session, offline, in a list -- without
 * a second read, and anything that already copes with cards (offline study,
 * saved sessions, moving decks) copes with diagram cards unchanged. The cost
 * is that editing a diagram rewrites every card of it, which the editor does in
 * one batch.
 *
 * The invariant the rest of this file keeps: a diagram's labels and groups are
 * exactly the ones that still have a card. Deleting a card removes its label
 * or group from the cards that remain, so reopening the editor never brings a
 * deleted card back.
 */

export type OcclusionPoint = { x: number; y: number };

/**
 * A box, an oval or a drawn outline, in fractions of the picture, so it sits in
 * the same place at any size.
 *
 * An outline's `points` are fractions of its own box rather than of the
 * picture. Moving or resizing it is then only the box changing, exactly as for
 * a rectangle, and the outline stretches with it.
 */
export type OcclusionShape = {
  kind: "rect" | "ellipse" | "polygon";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: OcclusionPoint[];
};

/**
 * Where a label's line points: the exact spot on the picture the label names,
 * optionally bent once on the way, as leader lines in textbooks often are.
 */
export type OcclusionPointer = OcclusionPoint & { bend?: OcclusionPoint };

export type OcclusionLabel = {
  id: string;
  /**
   * What the label says. Optional when the picture already prints it, since
   * uncovering the box shows it; required when Jami has to write it.
   */
  answer: string;
  /** Other answers marked right when typed: an abbreviation, the Latin, a synonym. */
  accepts?: string[];
  /** Shown with the answer, never before it. */
  note?: string;
  /** Usually one box. More when a label appears twice, or its line is covered too. */
  shapes: OcclusionShape[];
  /**
   * Where a line from the label's first box points. Optional. A box around a
   * whole structure needs none, but a box in the margin -- the way a textbook
   * labels a diagram -- says nothing without one.
   */
  pointer?: OcclusionPointer;
};

/** Labels asked together as one extra card: "name all four valves". */
export type OcclusionGroup = {
  id: string;
  /** Optional; the question under the picture uses it when there is one. */
  name: string;
  labelIds: string[];
};

/**
 * How the labels relate to the picture.
 *
 * `cover`: the picture has its labels printed and each box hides one. Reveal
 * uncovers it.
 * `name`: the picture has no labels, and the student names each part. A box
 * either surrounds the part, with its name written beside it on reveal, or --
 * when it has a pointer -- is a label slot in the margin with a line to the
 * part, and the name is written inside it.
 */
export type OcclusionLabelMode = "cover" | "name";

/**
 * How a diagram is studied.
 *
 * `whole`: one card for the whole diagram. Every label is covered and the
 * student works through them, uncovering each to check, then rates the diagram
 * once. It is the default for a new diagram, because a diagram is one thing
 * to a student, and thirteen cards of the same picture read as clutter.
 * `each`: a card for every label, each on its own schedule -- Anki's "hide
 * all, guess one" -- for a diagram with one or two labels that never stick.
 * Diagrams saved before the choice existed are `each`.
 */
export type OcclusionCardStyle = "whole" | "each";

/**
 * The group a whole-diagram card asks: every label. Kept as an ordinary group
 * so the study pipeline, which already asks groups as one card, needs nothing
 * new; the editor never shows it.
 */
export const WHOLE_DIAGRAM_GROUP_ID = "whole-diagram";

export function isWholeDiagramGroupId(groupId: string | undefined) {
  return groupId === WHOLE_DIAGRAM_GROUP_ID;
}

export type OcclusionDiagram = {
  id: string;
  image: CardImage;
  labelMode: OcclusionLabelMode;
  /**
   * Hide every label while one is asked (Anki's "Hide all, guess one"), or
   * hide only the one being asked. Hiding all is the harder, and the default,
   * because the other labels are often the clue.
   */
  hideOthers: boolean;
  labels: OcclusionLabel[];
  groups?: OcclusionGroup[];
  /** How lines end at the part: a dot, the default, or an arrowhead. */
  pointerEnd?: "dot" | "arrow";
  /** Absent on diagrams saved before there was a choice, which are `each`. */
  cardStyle?: OcclusionCardStyle;
};

/**
 * What sits on a card: the diagram, and what this card asks -- one label, or
 * one group of labels asked together. Exactly one of the two ids is set.
 */
export type CardOcclusion =
  | { diagram: OcclusionDiagram; labelId: string; groupId?: undefined }
  | { diagram: OcclusionDiagram; groupId: string; labelId?: undefined };

/** What one diagram card asks, without the diagram. */
export type OcclusionTarget = { labelId: string } | { groupId: string };

export const MAX_DIAGRAM_LABELS = 60;
export const MAX_DIAGRAM_GROUPS = 12;
export const MAX_SHAPES_PER_LABEL = 6;
export const MAX_LABEL_ANSWER_LENGTH = 120;
export const MAX_LABEL_NOTE_LENGTH = 300;
export const MAX_ACCEPTED_ANSWERS = 8;
export const MAX_ACCEPTED_ANSWER_LENGTH = 60;
export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_POLYGON_POINTS = 64;
/** Smaller than this, in either direction, a box is a slip of the pointer rather than a label. */
export const MIN_SHAPE_FRACTION = 0.008;
const MAX_ID_LENGTH = 64;

// ---------------------------------------------------------------------------
// Reading stored data

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Four decimal places is a tenth of a pixel on a 1,000px picture, and keeps documents small. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A point kept on the picture. */
export function clampPoint(point: OcclusionPoint): OcclusionPoint {
  return { x: round(clamp(point.x, 0, 1)), y: round(clamp(point.y, 0, 1)) };
}

/**
 * A shape kept inside the picture and at least the minimum size.
 *
 * Used on everything that is stored and everything the editor produces, so a
 * shape can never hang off an edge or collapse to nothing.
 */
export function clampShape(shape: OcclusionShape): OcclusionShape {
  const width = clamp(shape.width, MIN_SHAPE_FRACTION, 1);
  const height = clamp(shape.height, MIN_SHAPE_FRACTION, 1);
  return {
    kind: shape.kind,
    x: round(clamp(shape.x, 0, 1 - width)),
    y: round(clamp(shape.y, 0, 1 - height)),
    width: round(width),
    height: round(height),
    ...(shape.kind === "polygon" && shape.points
      ? { points: shape.points.slice(0, MAX_POLYGON_POINTS).map(clampPoint) }
      : {}),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePoint(value: unknown): OcclusionPoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y } = value as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined;
  return clampPoint({ x, y });
}

function normalizePointer(value: unknown): OcclusionPointer | undefined {
  const tip = normalizePoint(value);
  if (!tip) return undefined;
  const bend = normalizePoint((value as Record<string, unknown>).bend);
  return bend ? { ...tip, bend } : tip;
}

function normalizeShape(value: unknown): OcclusionShape | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const numbers = [input.x, input.y, input.width, input.height];
  if (!numbers.every(isFiniteNumber)) return null;
  const [x, y, width, height] = numbers as number[];
  if (width <= 0 || height <= 0) return null;
  if (input.kind === "polygon") {
    const points = Array.isArray(input.points)
      ? input.points.map(normalizePoint).filter((point): point is OcclusionPoint => Boolean(point))
      : [];
    // An outline needs three corners to enclose anything.
    if (points.length < 3) return null;
    return clampShape({ kind: "polygon", x, y, width, height, points });
  }
  return clampShape({ kind: input.kind === "ellipse" ? "ellipse" : "rect", x, y, width, height });
}

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim() && value.length <= MAX_ID_LENGTH
    ? value.trim()
    : "";
}

/**
 * Other answers a label accepts: trimmed, each once, and never the answer
 * itself again.
 */
export function cleanAcceptedAnswers(value: unknown, answer: string): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set([answer.trim().toLowerCase()]);
  const accepts: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry, MAX_ACCEPTED_ANSWER_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    accepts.push(text);
    if (accepts.length >= MAX_ACCEPTED_ANSWERS) break;
  }
  return accepts;
}

function normalizeLabel(value: unknown): OcclusionLabel | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = normalizeId(input.id);
  if (!id || !Array.isArray(input.shapes)) return null;
  const shapes = input.shapes
    .map(normalizeShape)
    .filter((shape): shape is OcclusionShape => shape !== null)
    .slice(0, MAX_SHAPES_PER_LABEL);
  if (shapes.length === 0) return null;
  const answer = normalizeText(input.answer, MAX_LABEL_ANSWER_LENGTH);
  const accepts = cleanAcceptedAnswers(input.accepts, answer);
  const note = normalizeText(input.note, MAX_LABEL_NOTE_LENGTH);
  const pointer = normalizePointer(input.pointer);
  return {
    id,
    answer,
    ...(accepts.length > 0 ? { accepts } : {}),
    ...(note ? { note } : {}),
    shapes,
    ...(pointer ? { pointer } : {}),
  };
}

/** Groups that name real labels, each once, with at least one label left. */
function normalizeGroups(value: unknown, labelIds: ReadonlySet<string>): OcclusionGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const groups: OcclusionGroup[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const input = entry as Record<string, unknown>;
    const id = normalizeId(input.id);
    if (!id || seen.has(id) || labelIds.has(id)) continue;
    const members = Array.isArray(input.labelIds)
      ? [...new Set(input.labelIds.map(normalizeId).filter((labelId) => labelIds.has(labelId)))]
      : [];
    if (members.length === 0) continue;
    seen.add(id);
    groups.push({ id, name: normalizeText(input.name, MAX_GROUP_NAME_LENGTH), labelIds: members });
    if (groups.length >= MAX_DIAGRAM_GROUPS) break;
  }
  return groups;
}

/**
 * A stored diagram, or nothing.
 *
 * The picture must be in the owner's own card image folder and have a known
 * size -- the boxes are laid out against it before it loads. Labels that do not
 * survive reading are dropped rather than failing the diagram.
 */
export function normalizeOcclusionDiagram(
  value: unknown,
  userId: string
): OcclusionDiagram | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const id = normalizeId(input.id);
  const image = normalizeCardImage(input.image, userId);
  if (!id || !image || image.width <= 0 || image.height <= 0 || !Array.isArray(input.labels)) {
    return undefined;
  }
  const seen = new Set<string>();
  const labels: OcclusionLabel[] = [];
  for (const entry of input.labels) {
    const label = normalizeLabel(entry);
    if (!label || seen.has(label.id)) continue;
    seen.add(label.id);
    labels.push(label);
    if (labels.length >= MAX_DIAGRAM_LABELS) break;
  }
  if (labels.length === 0) return undefined;
  const groups = normalizeGroups(input.groups, seen);
  return {
    id,
    image,
    labelMode: input.labelMode === "name" ? "name" : "cover",
    hideOthers: input.hideOthers !== false,
    labels,
    ...(groups.length > 0 ? { groups } : {}),
    ...(input.pointerEnd === "arrow" ? { pointerEnd: "arrow" as const } : {}),
    ...(input.cardStyle === "whole" ? { cardStyle: "whole" as const } : {}),
  };
}

/** A card's occlusion, or nothing when it is missing, malformed or asks for something the diagram lacks. */
export function normalizeCardOcclusion(
  value: unknown,
  userId: string
): CardOcclusion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const diagram = normalizeOcclusionDiagram(input.diagram, userId);
  if (!diagram) return undefined;
  const groupId = normalizeId(input.groupId);
  if (groupId) {
    return diagram.groups?.some((group) => group.id === groupId) ? { diagram, groupId } : undefined;
  }
  const labelId = normalizeId(input.labelId);
  return diagram.labels.some((label) => label.id === labelId) ? { diagram, labelId } : undefined;
}

// ---------------------------------------------------------------------------
// Reading what a card asks

/** A stable key for what a card asks, unique within its diagram. */
export function occlusionTargetKey(target: OcclusionTarget | CardOcclusion) {
  const groupId = "groupId" in target ? target.groupId : undefined;
  const labelId = "labelId" in target ? target.labelId : undefined;
  return groupId ? `group:${groupId}` : `label:${labelId ?? ""}`;
}

export function getOcclusionLabel(occlusion: CardOcclusion) {
  const index = occlusion.labelId
    ? occlusion.diagram.labels.findIndex((label) => label.id === occlusion.labelId)
    : -1;
  return { label: index >= 0 ? occlusion.diagram.labels[index] : undefined, index };
}

export function getOcclusionGroup(occlusion: CardOcclusion) {
  return occlusion.groupId
    ? occlusion.diagram.groups?.find((group) => group.id === occlusion.groupId)
    : undefined;
}

/** Every label a card asks: its own, or each label of its group, in diagram order. */
export function getOcclusionTargets(occlusion: CardOcclusion) {
  const group = getOcclusionGroup(occlusion);
  const ids = new Set(group ? group.labelIds : occlusion.labelId ? [occlusion.labelId] : []);
  const labels: OcclusionLabel[] = [];
  const indexes: number[] = [];
  occlusion.diagram.labels.forEach((label, index) => {
    if (!ids.has(label.id)) return;
    labels.push(label);
    indexes.push(index);
  });
  return { labels, indexes, group };
}

/** A label's name as a list shows it: its answer, or its number when it has none. */
export function getLabelDisplayName(label: Pick<OcclusionLabel, "answer">, index: number) {
  return label.answer.trim() || `Label ${index + 1}`;
}

/** A group card's answer: every named label of it, in order. */
export function getGroupAnswerText(diagram: OcclusionDiagram, group: OcclusionGroup) {
  const members = new Set(group.labelIds);
  return diagram.labels
    .filter((label) => members.has(label.id))
    .map((label) => label.answer.trim())
    .filter(Boolean)
    .join("; ");
}

/** A group's name as a list shows it. */
export function getGroupDisplayName(group: OcclusionGroup) {
  if (isWholeDiagramGroupId(group.id)) return "Whole diagram";
  return group.name.trim() || `${group.labelIds.length} labels together`;
}

/**
 * The words a diagram card is asked with, when its author wrote none.
 *
 * The picture is the question, but a line under it saying what to do stops an
 * outlined box reading as decoration.
 */
export function getOcclusionPrompt(occlusion: CardOcclusion, header: string) {
  const group = getOcclusionGroup(occlusion);
  if (group && isWholeDiagramGroupId(group.id)) {
    const ask = occlusion.diagram.labelMode === "cover" ? "Name every covered label" : "Name every marked part";
    return header.trim() ? `${header.trim()}: ${ask.charAt(0).toLowerCase()}${ask.slice(1)}.` : `${ask}.`;
  }
  if (group) {
    const count = group.labelIds.length;
    const ask = occlusion.diagram.labelMode === "cover" ? `Name the ${count} highlighted labels` : `Name the ${count} marked parts`;
    const lead = header.trim() || group.name.trim();
    return lead ? `${lead}: ${ask.charAt(0).toLowerCase()}${ask.slice(1)}.` : `${ask}.`;
  }
  if (header.trim()) return header.trim();
  if (occlusion.diagram.labelMode === "cover") return "What is under the highlighted box?";
  return getOcclusionLabel(occlusion).label?.pointer
    ? "What does the line point to?"
    : "Name the outlined part.";
}

/** Everything a typed answer to this card is marked right against, besides the answer itself. */
export function getOcclusionAcceptedAnswers(occlusion: CardOcclusion) {
  return getOcclusionLabel(occlusion).label?.accepts ?? [];
}

/**
 * The other labels of the same diagram, as wrong options for multiple choice.
 *
 * Multiple choice does not borrow answers from other cards, because an answer
 * to a different question is rarely a believable wrong one. A diagram is the
 * exception that proves the rule: its other labels are the same kind of thing,
 * sitting next to the right one, and confusing them is exactly the mistake a
 * student makes. The question hides every label while it is asked, so none can
 * be ruled out by reading it off the picture. A group card is never asked this
 * way, so it has none.
 */
export function getDiagramDistractorPool(occlusion: CardOcclusion) {
  const { label } = getOcclusionLabel(occlusion);
  if (!label) return [];
  const seen = new Set<string>([label.answer.trim().toLowerCase(), ...(label.accepts ?? []).map((text) => text.toLowerCase())]);
  const pool: string[] = [];
  for (const other of occlusion.diagram.labels) {
    const answer = other.answer.trim();
    const key = answer.toLowerCase();
    if (!answer || seen.has(key)) continue;
    seen.add(key);
    pool.push(answer);
  }
  return pool;
}

// ---------------------------------------------------------------------------
// What each box looks like

/**
 * `question`: the card is being asked.
 * `answer`: the asked label is revealed; the rest stay as they were.
 * `unmasked`: every label is shown, for looking the whole picture over.
 */
export type OcclusionPhase = "question" | "answer" | "unmasked";

/**
 * One box's state, independent of how it is drawn.
 *
 * `target-*` is a label being asked. `other-hidden` keeps a label covered
 * (cover) or unwritten (name); `other-shown` leaves the picture's own label
 * visible (cover) or writes the name in (name). `other-confused` is the label
 * the student gave instead of the right one, shown so the two can be told
 * apart.
 */
export type OcclusionMaskLook =
  | "target-hidden"
  | "target-revealed"
  | "other-hidden"
  | "other-shown"
  | "other-confused";

export type OcclusionMask = {
  label: OcclusionLabel;
  index: number;
  look: OcclusionMaskLook;
};

/**
 * Every label and how it should look, for one card at one moment.
 *
 * `hideOthers` overrides the diagram's own setting. Multiple choice passes
 * true, because its options are the other labels and a visible one can be
 * crossed off without knowing anything. `confusedLabelId`, on the answer side,
 * picks out the label the student mixed this one up with.
 */
export function getOcclusionMasks(
  occlusion: CardOcclusion,
  phase: OcclusionPhase,
  options: { hideOthers?: boolean; confusedLabelId?: string | null } = {}
): OcclusionMask[] {
  const hideOthers = options.hideOthers ?? occlusion.diagram.hideOthers;
  const targets = new Set(getOcclusionTargets(occlusion).labels.map((label) => label.id));
  return occlusion.diagram.labels.map((label, index) => {
    if (targets.has(label.id)) {
      return { label, index, look: phase === "question" ? "target-hidden" : "target-revealed" };
    }
    if (phase !== "question" && options.confusedLabelId === label.id) {
      return { label, index, look: "other-confused" };
    }
    const hidden = phase !== "unmasked" && hideOthers;
    return { label, index, look: hidden ? "other-hidden" : "other-shown" };
  });
}

/**
 * Every label for going over a whole diagram by hand, uncovering them one at
 * a time: each is asked, covered until the student taps it and revealed after.
 *
 * This is practice, not review -- nothing it does reaches a schedule.
 */
export function getWalkthroughMasks(
  diagram: OcclusionDiagram,
  revealedLabelIds: ReadonlySet<string>
): OcclusionMask[] {
  return diagram.labels.map((label, index) => ({
    label,
    index,
    look: revealedLabelIds.has(label.id) ? "target-revealed" : "target-hidden",
  }));
}

/**
 * How one label is drawn at one moment, whatever draws it.
 *
 * - `cover` / `cover-asked`: a solid box hiding what is under it.
 * - `outline` / `outline-asked` / `outline-confused`: a ring around the part,
 *   the picture visible through it.
 * - `slot` / `slot-asked` / `slot-confused`: a blank label in the margin, for
 *   a named part with a pointer; its name is written inside.
 *
 * `inside` and `beside` say which words go in or next to the first box:
 * the question mark, the answer, or none. `pointer` is the line's tone, or
 * null when there is no line to draw.
 */
export type OcclusionMaskDrawing = {
  box:
    | "cover"
    | "cover-asked"
    | "outline"
    | "outline-asked"
    | "outline-confused"
    | "slot"
    | "slot-asked"
    | "slot-confused"
    | null;
  inside: "question" | "answer" | null;
  beside: "question" | "answer" | null;
  pointer: "asked" | "other" | "confused" | null;
};

export function describeOcclusionMask(
  labelMode: OcclusionLabelMode,
  mask: Pick<OcclusionMask, "label" | "look">
): OcclusionMaskDrawing {
  const hasPointer = Boolean(mask.label.pointer);
  const draw = (
    box: OcclusionMaskDrawing["box"],
    inside: OcclusionMaskDrawing["inside"] = null,
    beside: OcclusionMaskDrawing["beside"] = null
  ): OcclusionMaskDrawing => {
    const tone = !box
      ? null
      : box.endsWith("-asked")
        ? "asked"
        : box.endsWith("-confused")
          ? "confused"
          : "other";
    return { box, inside, beside, pointer: hasPointer ? tone : null };
  };

  if (labelMode === "cover") {
    switch (mask.look) {
      case "target-hidden":
        return draw("cover-asked", "question");
      case "target-revealed":
        return draw("outline-asked");
      case "other-hidden":
        return draw("cover");
      case "other-confused":
        // Uncovered, so the label the student gave is read off the picture.
        return draw("outline-confused");
      default:
        // The picture's own label shows, with its own printed line.
        return draw(null);
    }
  }

  if (hasPointer) {
    switch (mask.look) {
      case "target-hidden":
        return draw("cover-asked", "question");
      case "target-revealed":
        return draw("slot-asked", "answer");
      case "other-hidden":
        return draw("slot");
      case "other-confused":
        return draw("slot-confused", "answer");
      default:
        return draw("slot", "answer");
    }
  }

  switch (mask.look) {
    case "target-hidden":
      return draw("outline-asked", null, "question");
    case "target-revealed":
      return draw("outline-asked", null, "answer");
    case "other-hidden":
      return draw(null);
    case "other-confused":
      return draw("outline-confused", null, "answer");
    default:
      return draw("outline", null, "answer");
  }
}

// ---------------------------------------------------------------------------
// Geometry

/** An outline's corners in fractions of the picture. */
export function polygonPoints(shape: OcclusionShape): OcclusionPoint[] {
  return (shape.points ?? []).map((point) => ({
    x: shape.x + point.x * shape.width,
    y: shape.y + point.y * shape.height,
  }));
}

function pointInPolygon(point: OcclusionPoint, polygon: readonly OcclusionPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function nearestPointOnSegment(point: OcclusionPoint, a: OcclusionPoint, b: OcclusionPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * The line from a label's box to what it points at, in fractions of the
 * picture, or null when the line would start inside the box.
 *
 * It leaves the box's edge rather than its middle, as a printed leader line
 * does, heading for the bend when there is one. Worked out in pixels, because
 * an oval on a wide picture is only round on screen.
 */
export function getPointerLine(
  shape: OcclusionShape,
  pointer: OcclusionPointer,
  imageWidth: number,
  imageHeight: number
) {
  const toPixels = (point: OcclusionPoint) => ({ x: point.x * imageWidth, y: point.y * imageHeight });
  const aim = toPixels(pointer.bend ?? pointer);
  const left = shape.x * imageWidth;
  const top = shape.y * imageHeight;
  const width = shape.width * imageWidth;
  const height = shape.height * imageHeight;
  let start: OcclusionPoint;

  if (shape.kind === "ellipse") {
    const centre = { x: left + width / 2, y: top + height / 2 };
    const dx = aim.x - centre.x;
    const dy = aim.y - centre.y;
    const reach = Math.hypot(dx / (width / 2), dy / (height / 2));
    if (reach <= 1) return null;
    start = { x: centre.x + dx / reach, y: centre.y + dy / reach };
  } else if (shape.kind === "polygon") {
    const outline = polygonPoints(shape).map(toPixels);
    if (outline.length < 3 || pointInPolygon(aim, outline)) return null;
    let best = outline[0];
    let bestDistance = Infinity;
    for (let index = 0; index < outline.length; index += 1) {
      const candidate = nearestPointOnSegment(aim, outline[index], outline[(index + 1) % outline.length]);
      const distance = Math.hypot(candidate.x - aim.x, candidate.y - aim.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    start = best;
  } else {
    // The nearest point of the box: straight out from the side facing the aim.
    start = { x: clamp(aim.x, left, left + width), y: clamp(aim.y, top, top + height) };
    if (start.x === aim.x && start.y === aim.y) return null;
  }

  return {
    x1: start.x / imageWidth,
    y1: start.y / imageHeight,
    ...(pointer.bend ? { bend: { x: pointer.bend.x, y: pointer.bend.y } } : {}),
    x2: pointer.x,
    y2: pointer.y,
  };
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/** The box between two corners, dragged in any direction. */
export function shapeFromPoints(
  kind: "rect" | "ellipse",
  start: OcclusionPoint,
  end: OcclusionPoint
): OcclusionShape {
  const left = clamp(Math.min(start.x, end.x), 0, 1);
  const top = clamp(Math.min(start.y, end.y), 0, 1);
  const right = clamp(Math.max(start.x, end.x), 0, 1);
  const bottom = clamp(Math.max(start.y, end.y), 0, 1);
  return clampShape({ kind, x: left, y: top, width: right - left, height: bottom - top });
}

/**
 * The box a tap makes, centred where the finger landed.
 *
 * Label-shaped: about three times as wide as it is tall on screen, whatever
 * the picture's proportions, because a tap is almost always on a word. On a
 * phone this is the quickest way to cover a label -- tap, then drag a corner
 * if it needs to be bigger.
 */
export function defaultShapeAt(
  kind: "rect" | "ellipse",
  point: OcclusionPoint,
  imageAspect: number
): OcclusionShape {
  const width = 0.16;
  const height = clamp((width * imageAspect) / 3, 0.025, 0.2);
  return clampShape({ kind, x: point.x - width / 2, y: point.y - height / 2, width, height });
}

function distanceToSegment(point: OcclusionPoint, a: OcclusionPoint, b: OcclusionPoint) {
  const nearest = nearestPointOnSegment(point, a, b);
  return Math.hypot(point.x - nearest.x, point.y - nearest.y);
}

/** Ramer-Douglas-Peucker: the fewest corners that stay within `tolerance` of the path. */
export function simplifyPath(path: readonly OcclusionPoint[], tolerance: number): OcclusionPoint[] {
  if (path.length <= 2) return [...path];
  let furthest = 0;
  let index = 0;
  for (let position = 1; position < path.length - 1; position += 1) {
    const distance = distanceToSegment(path[position], path[0], path[path.length - 1]);
    if (distance > furthest) {
      furthest = distance;
      index = position;
    }
  }
  if (furthest <= tolerance) return [path[0], path[path.length - 1]];
  const head = simplifyPath(path.slice(0, index + 1), tolerance);
  const tail = simplifyPath(path.slice(index), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * An outline from a freehand path traced round a part, or null for a scribble
 * too small or too thin to enclose anything.
 *
 * Simplified in on-screen proportions (`imageAspect`), so a wide picture is not
 * over-simplified across and under-simplified down.
 */
export function polygonShapeFromPath(
  path: readonly OcclusionPoint[],
  imageAspect: number
): OcclusionShape | null {
  const inScreenSpace = path.map((point) => ({ x: point.x * imageAspect, y: point.y }));
  let corners = simplifyPath(inScreenSpace, 0.004).map((point) => ({ x: point.x / imageAspect, y: point.y }));
  const first = corners[0];
  const last = corners.at(-1);
  // Closing the loop is implied; a last corner on top of the first is a duplicate.
  if (first && last && corners.length > 3 && Math.hypot(first.x - last.x, first.y - last.y) < 0.01) {
    corners = corners.slice(0, -1);
  }
  if (corners.length < 3) return null;
  if (corners.length > MAX_POLYGON_POINTS) {
    const step = corners.length / MAX_POLYGON_POINTS;
    corners = Array.from({ length: MAX_POLYGON_POINTS }, (_, index) => corners[Math.floor(index * step)]);
  }
  const clamped = corners.map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }));
  const xs = clamped.map((point) => point.x);
  const ys = clamped.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  if (width < MIN_SHAPE_FRACTION * 2 || height < MIN_SHAPE_FRACTION * 2) return null;
  return clampShape({
    kind: "polygon",
    x: left,
    y: top,
    width,
    height,
    points: clamped.map((point) => ({ x: (point.x - left) / width, y: (point.y - top) / height })),
  });
}

export function moveShape(shape: OcclusionShape, dx: number, dy: number): OcclusionShape {
  return clampShape({ ...shape, x: shape.x + dx, y: shape.y + dy });
}

/**
 * Drag one corner; the opposite corner stays where it was. An outline's
 * corners are fractions of its box, so it stretches with the box.
 */
export function resizeShape(
  shape: OcclusionShape,
  handle: ResizeHandle,
  point: OcclusionPoint
): OcclusionShape {
  const anchor = {
    x: handle === "nw" || handle === "sw" ? shape.x + shape.width : shape.x,
    y: handle === "nw" || handle === "ne" ? shape.y + shape.height : shape.y,
  };
  const box = shapeFromPoints("rect", anchor, point);
  return clampShape({ ...shape, x: box.x, y: box.y, width: box.width, height: box.height });
}

export function shapeContainsPoint(shape: OcclusionShape, point: OcclusionPoint) {
  if (shape.kind === "ellipse") {
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    const dx = (point.x - (shape.x + rx)) / rx;
    const dy = (point.y - (shape.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (shape.kind === "polygon") return pointInPolygon(point, polygonPoints(shape));
  return (
    point.x >= shape.x &&
    point.x <= shape.x + shape.width &&
    point.y >= shape.y &&
    point.y <= shape.y + shape.height
  );
}

/** The topmost box under a point: later boxes are drawn over earlier ones. */
export function findShapeAt(labels: readonly OcclusionLabel[], point: OcclusionPoint) {
  for (let labelIndex = labels.length - 1; labelIndex >= 0; labelIndex -= 1) {
    const label = labels[labelIndex];
    for (let shapeIndex = label.shapes.length - 1; shapeIndex >= 0; shapeIndex -= 1) {
      if (shapeContainsPoint(label.shapes[shapeIndex], point)) {
        return { labelId: label.id, shapeIndex };
      }
    }
  }
  return null;
}

/** A crop, as fractions of the picture before cropping. */
export type OcclusionCrop = { x: number; y: number; width: number; height: number };

function cropPoint(point: OcclusionPoint, crop: OcclusionCrop) {
  return { x: (point.x - crop.x) / crop.width, y: (point.y - crop.y) / crop.height };
}

const onPicture = (point: OcclusionPoint) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

function cropShape(shape: OcclusionShape, crop: OcclusionCrop): OcclusionShape | null {
  const left = Math.max(shape.x, crop.x);
  const top = Math.max(shape.y, crop.y);
  const right = Math.min(shape.x + shape.width, crop.x + crop.width);
  const bottom = Math.min(shape.y + shape.height, crop.y + crop.height);
  if (right <= left || bottom <= top) return null;
  const kept = ((right - left) * (bottom - top)) / (shape.width * shape.height);
  if (kept < 0.5) return null;
  if (shape.kind === "polygon") {
    // Corners past the crop are pulled onto its edge, then the box is refitted.
    const corners = polygonPoints(shape).map((point) => {
      const moved = cropPoint(point, crop);
      return { x: clamp(moved.x, 0, 1), y: clamp(moved.y, 0, 1) };
    });
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(Math.max(...xs) - x, MIN_SHAPE_FRACTION);
    const height = Math.max(Math.max(...ys) - y, MIN_SHAPE_FRACTION);
    return clampShape({
      kind: "polygon",
      x,
      y,
      width,
      height,
      points: corners.map((point) => ({ x: (point.x - x) / width, y: (point.y - y) / height })),
    });
  }
  return clampShape({
    kind: shape.kind,
    x: (left - crop.x) / crop.width,
    y: (top - crop.y) / crop.height,
    width: (right - left) / crop.width,
    height: (bottom - top) / crop.height,
  });
}

/**
 * Labels moved into a cropped picture.
 *
 * A box mostly inside the crop is cut to its edge and kept; one mostly
 * outside is dropped, and so is a label left with no boxes. Mostly means half:
 * less than that and what remains no longer covers the word it was drawn on.
 * A pointer whose tip is cropped away loses its line, and a bend cropped away
 * leaves the line straight; the box stays either way.
 */
export function cropLabels(labels: readonly OcclusionLabel[], crop: OcclusionCrop): OcclusionLabel[] {
  const result: OcclusionLabel[] = [];
  for (const label of labels) {
    const shapes = label.shapes
      .map((shape) => cropShape(shape, crop))
      .filter((shape): shape is OcclusionShape => shape !== null);
    if (shapes.length === 0) continue;
    const { pointer, ...rest } = label;
    const tip = pointer ? cropPoint(pointer, crop) : null;
    const bend = pointer?.bend ? cropPoint(pointer.bend, crop) : null;
    const moved: OcclusionPointer | null =
      tip && onPicture(tip)
        ? { ...clampPoint(tip), ...(bend && onPicture(bend) ? { bend: clampPoint(bend) } : {}) }
        : null;
    result.push({ ...rest, shapes, ...(moved ? { pointer: moved } : {}) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Saving

/**
 * Why a diagram cannot be saved yet, or null.
 *
 * A covered label may be left unnamed -- uncovering the box shows it -- but it
 * can then only be flipped, never typed or chosen. A named part has nothing on
 * the picture to reveal, so it must have a name. A group asks two labels or
 * more; one label asked on its own already has its card.
 */
export function getDiagramDraftError(input: {
  labelMode: OcclusionLabelMode;
  labels: readonly OcclusionLabel[];
  groups?: readonly OcclusionGroup[];
}) {
  if (input.labels.length === 0) {
    return input.labelMode === "name"
      ? "Draw a box around at least one part."
      : "Draw a box over at least one label.";
  }
  if (input.labels.length > MAX_DIAGRAM_LABELS) {
    return `A diagram can have up to ${MAX_DIAGRAM_LABELS} labels. Split it into two pictures.`;
  }
  if (input.labelMode === "name") {
    const unnamed = input.labels.findIndex((label) => !label.answer.trim());
    if (unnamed >= 0) return `Label ${unnamed + 1} needs a name. Nothing on the picture can reveal it.`;
  }
  const tooLong = input.labels.findIndex((label) => label.answer.trim().length > MAX_LABEL_ANSWER_LENGTH);
  if (tooLong >= 0) {
    return `Label ${tooLong + 1} is longer than ${MAX_LABEL_ANSWER_LENGTH} characters. Keep labels to a few words and put the rest in its note.`;
  }
  const labelIds = new Set(input.labels.map((label) => label.id));
  const small = (input.groups ?? []).findIndex(
    (group) => group.labelIds.filter((labelId) => labelIds.has(labelId)).length < 2
  );
  if (small >= 0) return `Group ${small + 1} needs at least two labels to ask together.`;
  if ((input.groups ?? []).length > MAX_DIAGRAM_GROUPS) {
    return `A diagram can have up to ${MAX_DIAGRAM_GROUPS} groups.`;
  }
  return null;
}

/** Labels as they are stored: trimmed, bounded and with every box inside the picture. */
export function cleanDiagramLabels(labels: readonly OcclusionLabel[]): OcclusionLabel[] {
  return labels.slice(0, MAX_DIAGRAM_LABELS).map((label) => {
    const answer = normalizeText(label.answer, MAX_LABEL_ANSWER_LENGTH);
    const accepts = cleanAcceptedAnswers(label.accepts, answer);
    const note = normalizeText(label.note, MAX_LABEL_NOTE_LENGTH);
    return {
      id: label.id,
      answer,
      ...(accepts.length > 0 ? { accepts } : {}),
      ...(note ? { note } : {}),
      shapes: label.shapes.slice(0, MAX_SHAPES_PER_LABEL).map(clampShape),
      ...(label.pointer
        ? {
            pointer: {
              ...clampPoint(label.pointer),
              ...(label.pointer.bend ? { bend: clampPoint(label.pointer.bend) } : {}),
            },
          }
        : {}),
    };
  });
}

/** Groups as they are stored: real labels only, each once, and never fewer than two. */
export function cleanDiagramGroups(
  groups: readonly OcclusionGroup[],
  labels: readonly Pick<OcclusionLabel, "id">[]
): OcclusionGroup[] {
  const labelIds = new Set(labels.map((label) => label.id));
  return groups
    .map((group) => ({
      id: group.id,
      name: normalizeText(group.name, MAX_GROUP_NAME_LENGTH),
      labelIds: [...new Set(group.labelIds.filter((labelId) => labelIds.has(labelId)))],
    }))
    .filter((group) => group.labelIds.length >= 2)
    .slice(0, MAX_DIAGRAM_GROUPS);
}

type DiagramCardRef = { id: string; occlusion?: CardOcclusion };

/**
 * Which cards a diagram save creates, keeps and deletes.
 *
 * A label -- or a group -- keeps the card it had, and with it every review it
 * has had, for as long as it exists, however much its box moves or its words
 * change. A new one gets a new card; one that was removed takes its card with
 * it. Two cards claiming one target is not something the app writes, but if it
 * happens the first survives and the extra goes, rather than a label being
 * asked twice.
 */
export function planDiagramSave(existing: readonly DiagramCardRef[], targets: readonly OcclusionTarget[]) {
  const wanted = new Map(targets.map((target) => [occlusionTargetKey(target), target]));
  const cardByKey = new Map<string, string>();
  const remove: string[] = [];
  for (const card of existing) {
    const key = card.occlusion ? occlusionTargetKey(card.occlusion) : "";
    if (!key || !wanted.has(key) || cardByKey.has(key)) {
      remove.push(card.id);
      continue;
    }
    cardByKey.set(key, card.id);
  }
  return {
    keep: [...cardByKey].map(([key, cardId]) => ({ target: wanted.get(key)!, cardId })),
    create: [...wanted].filter(([key]) => !cardByKey.has(key)).map(([, target]) => target),
    remove,
  };
}

/**
 * A diagram's groups for its card style: a whole-diagram diagram asks one
 * group of every label and nothing else; a label-by-label one never carries
 * that group. Applied when a diagram is saved, so what is stored always
 * matches the cards it has.
 */
export function groupsForCardStyle(
  diagram: Pick<OcclusionDiagram, "labels" | "groups" | "cardStyle">
): OcclusionGroup[] {
  if (diagram.cardStyle === "whole") {
    return diagram.labels.length >= 2
      ? [{ id: WHOLE_DIAGRAM_GROUP_ID, name: "", labelIds: diagram.labels.map((label) => label.id) }]
      : [];
  }
  return (diagram.groups ?? []).filter((group) => !isWholeDiagramGroupId(group.id));
}

/**
 * Every card a diagram has: one for the whole diagram, or one per label and
 * then one per group. A whole diagram of a single label is that label's card.
 */
export function getDiagramTargets(
  diagram: Pick<OcclusionDiagram, "labels" | "groups" | "cardStyle">
): OcclusionTarget[] {
  if (diagram.cardStyle === "whole" && diagram.labels.length >= 2) {
    return [{ groupId: WHOLE_DIAGRAM_GROUP_ID }];
  }
  return [
    ...diagram.labels.map((label) => ({ labelId: label.id })),
    ...(diagram.groups ?? []).map((group) => ({ groupId: group.id })),
  ];
}

/**
 * What to tidy after cards were deleted.
 *
 * `survivors` are the cards that still exist for the deleted cards' diagrams,
 * read fresh. Each survivor loses the labels and groups nobody has a card for
 * any more, so the diagram stays equal to its cards. A group left with none of
 * its labels asks nothing, so its card goes too (`deletes`). A diagram with no
 * survivors frees its picture -- unless another diagram shares it, which the
 * caller checks.
 */
export function planDiagramCleanup(
  deleted: readonly DiagramCardRef[],
  survivors: readonly DiagramCardRef[]
) {
  const deletedIds = new Set(deleted.map((card) => card.id));
  const diagrams = new Map<string, OcclusionDiagram>();
  for (const card of deleted) {
    if (card.occlusion) diagrams.set(card.occlusion.diagram.id, card.occlusion.diagram);
  }

  const updates: Array<{ cardId: string; occlusion: CardOcclusion }> = [];
  const deletes: string[] = [];
  const orphanedImages: CardImage[] = [];
  for (const [diagramId, deletedDiagram] of diagrams) {
    const remaining = survivors.filter(
      (card) => !deletedIds.has(card.id) && card.occlusion?.diagram.id === diagramId
    );
    // A whole-diagram card keeps every label of its diagram alive: its labels have no cards of their own.
    const liveLabelIds = new Set(
      remaining.flatMap((card) =>
        card.occlusion?.labelId
          ? [card.occlusion.labelId]
          : card.occlusion?.groupId && isWholeDiagramGroupId(card.occlusion.groupId)
            ? card.occlusion.diagram.labels.map((label) => label.id)
            : []
      )
    );
    const liveGroupIds = new Set(remaining.flatMap((card) => (card.occlusion?.groupId ? [card.occlusion.groupId] : [])));
    const emptied = new Set<string>();
    const pruned = (diagram: OcclusionDiagram): OcclusionDiagram => {
      const labels = diagram.labels.filter((label) => liveLabelIds.has(label.id));
      const groups = (diagram.groups ?? []).flatMap((group) => {
        if (!liveGroupIds.has(group.id)) return [];
        const labelIds = group.labelIds.filter((labelId) => liveLabelIds.has(labelId));
        if (labelIds.length === 0) {
          emptied.add(group.id);
          return [];
        }
        return [{ ...group, labelIds }];
      });
      const { groups: _unused, ...rest } = diagram;
      void _unused;
      return { ...rest, labels, ...(groups.length > 0 ? { groups } : {}) };
    };

    const kept: DiagramCardRef[] = [];
    for (const card of remaining) {
      const occlusion = card.occlusion!;
      const diagram = pruned(occlusion.diagram);
      if (occlusion.groupId && emptied.has(occlusion.groupId)) {
        deletes.push(card.id);
        continue;
      }
      kept.push(card);
      if (JSON.stringify(diagram) === JSON.stringify(occlusion.diagram)) continue;
      updates.push({ cardId: card.id, occlusion: { ...occlusion, diagram } });
    }
    if (kept.length === 0) orphanedImages.push(deletedDiagram.image);
  }
  return { updates, deletes, orphanedImages };
}

/** A page's cards with a cleanup's diagram changes applied. */
export function applyOcclusionUpdates<T extends DiagramCardRef>(
  cards: readonly T[],
  updates: ReadonlyArray<{ cardId: string; occlusion: CardOcclusion }>,
  deletedCardIds: readonly string[] = []
): T[] {
  const deleted = new Set(deletedCardIds);
  const byId = new Map(updates.map((update) => [update.cardId, update.occlusion]));
  return cards
    .filter((card) => !deleted.has(card.id))
    .map((card) => {
      const occlusion = byId.get(card.id);
      return occlusion ? { ...card, occlusion } : card;
    });
}

/**
 * A page's cards after a diagram save: removed labels gone, kept labels
 * replaced, new labels added at the front where a newest-first list puts them.
 */
export function mergeSavedDiagramCards<T extends { id: string }>(
  cards: readonly T[],
  saved: readonly T[],
  removedCardIds: readonly string[]
): T[] {
  const removed = new Set(removedCardIds);
  const savedById = new Map(saved.map((card) => [card.id, card]));
  const existingIds = new Set(cards.map((card) => card.id));
  const added = saved.filter((card) => !existingIds.has(card.id));
  const kept = cards
    .filter((card) => !removed.has(card.id))
    .map((card) => savedById.get(card.id) ?? card);
  return [...added, ...kept];
}

/** Where a card sits in its diagram's order: its label's place, then groups after every label. */
export function occlusionOrder(occlusion: CardOcclusion) {
  if (occlusion.groupId) {
    const index = (occlusion.diagram.groups ?? []).findIndex((group) => group.id === occlusion.groupId);
    return occlusion.diagram.labels.length + Math.max(0, index);
  }
  return Math.max(0, getOcclusionLabel(occlusion).index);
}

/**
 * Sibling cards grouped by diagram, in label order.
 *
 * For lists that show a diagram once rather than once per label.
 */
export function groupDiagramCards<T extends DiagramCardRef>(cards: readonly T[]) {
  const groups = new Map<string, { diagram: OcclusionDiagram; cards: T[] }>();
  for (const card of cards) {
    if (!card.occlusion) continue;
    const { diagram } = card.occlusion;
    const group = groups.get(diagram.id);
    if (group) group.cards.push(card);
    else groups.set(diagram.id, { diagram, cards: [card] });
  }
  for (const group of groups.values()) {
    group.cards.sort((left, right) => occlusionOrder(left.occlusion!) - occlusionOrder(right.occlusion!));
  }
  return [...groups.values()];
}
