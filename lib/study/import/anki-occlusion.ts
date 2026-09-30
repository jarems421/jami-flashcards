import {
  MAX_DIAGRAM_LABELS,
  MAX_LABEL_NOTE_LENGTH,
  MAX_POLYGON_POINTS,
  MAX_SHAPES_PER_LABEL,
  clampShape,
  type OcclusionLabel,
  type OcclusionPoint,
  type OcclusionShape,
} from "@/lib/study/image-occlusion";
import { cleanAnkiField, decodeHtmlEntities } from "@/lib/study/import/anki-text";

/**
 * Anki's image occlusion notes, turned into Jami diagrams.
 *
 * Anki (23.10 and later) stores an occlusion note as fields: the occlusions,
 * written as clozes -- `{{c1::image-occlusion:rect:left=.29:top=.17:width=.1:height=.05:oi=1}}`
 * -- then the picture, a header and "back extra". Shapes sharing a cloze
 * number are one card, which is exactly a Jami label with several boxes, so
 * each cloze number becomes one label. Anki never names what is under a box;
 * the picture does, so every label arrives as a covered, unnamed label that
 * the student can name later if they want to type it.
 *
 * Pure: reading the fields. `anki-package.ts` finds the picture's bytes.
 */

/** A shape as Anki wrote it: fractions of the picture in current Anki, pixels in some older builds. */
type RawShape = {
  kind: "rect" | "ellipse" | "polygon";
  x: number;
  y: number;
  width: number;
  height: number;
  points?: OcclusionPoint[];
};

export type AnkiDiagramDraft = {
  noteId: number;
  header: string;
  /** Anki's "Back Extra", shown with each label's answer. */
  note: string;
  /** The picture's file name inside the package's media. */
  imageName: string;
  /** Anki's "Hide all, guess one" (`oi=1`) against "Hide one, guess one". */
  hideOthers: boolean;
  labels: Array<{ ordinal: number; shapes: RawShape[] }>;
};

const OCCLUSION_MARK = /image-occlusion:/i;
const OCCLUSION_CLOZE = /\{\{c(\d+)::image-occlusion:([a-z]+)((?::[^:}]*)*)\}\}/gi;
const IMAGE_SOURCE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;

export function isImageOcclusionNote(fields: readonly string[]) {
  return fields.some((field) => OCCLUSION_MARK.test(field));
}

function readProperties(text: string) {
  const properties = new Map<string, string>();
  for (const part of text.split(":")) {
    const equals = part.indexOf("=");
    if (equals > 0) properties.set(part.slice(0, equals).trim(), part.slice(equals + 1).trim());
  }
  return properties;
}

function number(properties: Map<string, string>, key: string) {
  const value = Number.parseFloat(properties.get(key) ?? "");
  return Number.isFinite(value) ? value : null;
}

function readShape(kind: string, properties: Map<string, string>): RawShape | null {
  if (kind === "rect") {
    const [x, y, width, height] = ["left", "top", "width", "height"].map((key) => number(properties, key));
    if (x === null || y === null || !width || !height || width <= 0 || height <= 0) return null;
    return { kind: "rect", x, y, width, height };
  }
  if (kind === "ellipse") {
    const [x, y, rx, ry] = ["left", "top", "rx", "ry"].map((key) => number(properties, key));
    if (x === null || y === null || !rx || !ry || rx <= 0 || ry <= 0) return null;
    return { kind: "ellipse", x, y, width: rx * 2, height: ry * 2 };
  }
  if (kind === "polygon") {
    const points = (properties.get("points") ?? "")
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number.parseFloat))
      .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
      .map(([x, y]) => ({ x, y }));
    if (points.length < 3) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width <= 0 || height <= 0) return null;
    return {
      kind: "polygon",
      x,
      y,
      width,
      height,
      points: points.slice(0, MAX_POLYGON_POINTS).map((point) => ({ x: (point.x - x) / width, y: (point.y - y) / height })),
    };
  }
  // Text annotations are shown on the picture, not asked; nothing to make a card from.
  return null;
}

function imageName(field: string) {
  const match = IMAGE_SOURCE.exec(field);
  const raw = decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * One occlusion note as a diagram draft, or null when it has nothing to ask
 * or no picture to ask it on.
 *
 * The stock note type puts the occlusions first, then the picture, the header
 * and the back extra; the occlusions and picture are found by what is in
 * them, and the header and extra by position when the layout is the stock one.
 */
export function parseImageOcclusionNote(noteId: number, fields: readonly string[]): AnkiDiagramDraft | null {
  const occlusionIndex = fields.findIndex((field) => OCCLUSION_MARK.test(field));
  const imageIndex = fields.findIndex((field, index) => index !== occlusionIndex && IMAGE_SOURCE.test(field));
  if (occlusionIndex < 0 || imageIndex < 0) return null;
  const name = imageName(fields[imageIndex]);
  if (!name) return null;

  const byOrdinal = new Map<number, RawShape[]>();
  let hideAll = false;
  for (const match of fields[occlusionIndex].matchAll(OCCLUSION_CLOZE)) {
    const ordinal = Number(match[1]);
    const properties = readProperties(match[3] ?? "");
    if (properties.get("oi") === "1") hideAll = true;
    const shape = readShape(match[2].toLowerCase(), properties);
    if (!shape || !Number.isFinite(ordinal)) continue;
    const shapes = byOrdinal.get(ordinal) ?? [];
    if (shapes.length < MAX_SHAPES_PER_LABEL) shapes.push(shape);
    byOrdinal.set(ordinal, shapes);
  }
  if (byOrdinal.size === 0) return null;

  const stock = occlusionIndex === 0 && imageIndex === 1;
  const header = stock && fields[2] ? cleanAnkiField(fields[2]).text : "";
  const note = stock && fields[3] ? cleanAnkiField(fields[3]).text.slice(0, MAX_LABEL_NOTE_LENGTH) : "";
  return {
    noteId,
    header,
    note,
    imageName: name,
    hideOthers: hideAll,
    labels: [...byOrdinal]
      .sort(([left], [right]) => left - right)
      .slice(0, MAX_DIAGRAM_LABELS)
      .map(([ordinal, shapes]) => ({ ordinal, shapes })),
  };
}

/**
 * A draft's labels against its picture's real size.
 *
 * Current Anki writes fractions of the picture; some earlier builds wrote
 * pixels. Anything past 1.5 can only be pixels, so the whole note is read as
 * pixels then and divided by the picture's size.
 */
export function ankiDraftToLabels(
  draft: AnkiDiagramDraft,
  imageWidth: number,
  imageHeight: number,
  newId: () => string
): OcclusionLabel[] {
  const inPixels = draft.labels.some((label) =>
    label.shapes.some((shape) => [shape.x, shape.y, shape.width, shape.height].some((value) => value > 1.5))
  );
  const scaleX = inPixels ? 1 / Math.max(1, imageWidth) : 1;
  const scaleY = inPixels ? 1 / Math.max(1, imageHeight) : 1;
  return draft.labels.map((label) => ({
    id: newId(),
    answer: "",
    ...(draft.note ? { note: draft.note } : {}),
    shapes: label.shapes.map(
      (shape): OcclusionShape =>
        clampShape({
          kind: shape.kind,
          x: shape.x * scaleX,
          y: shape.y * scaleY,
          width: shape.width * scaleX,
          height: shape.height * scaleY,
          ...(shape.points ? { points: shape.points } : {}),
        })
    ),
  }));
}
