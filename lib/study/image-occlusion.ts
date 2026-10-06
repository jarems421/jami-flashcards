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
