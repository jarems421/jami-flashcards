/**
 * The static SVG of an ink document: for previews, the server (rendered by
 * librsvg through `sharp`) and the rollback copy a js-draw build loads.
 *
 * There is no stylesheet; every path carries its own paint, so librsvg and
 * js-draw read it the same way. Highlighter ink comes first so it sits under
 * pen ink, as it does on screen.
 */

import { formatInkColor } from "@/lib/ink/color";
import { formatNumber, formatSvgPathData } from "@/lib/ink/path";
import { inkShapePath } from "@/lib/ink/shapes";
import { inkItemLayer, type InkDocument, type InkItem } from "@/lib/ink/model";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

const PATH_DECIMALS = 4;

function pathElement(d: string, attributes: string): string {
  return `<path d="${d}" ${attributes}></path>`;
}

function itemElement(item: InkItem): string | null {
  if (item.kind === "unknown") return null;
  if (item.kind === "shape") {
    const d = formatSvgPathData(inkShapePath(item.shape, item.width), PATH_DECIMALS);
    return pathElement(
      d,
      `fill="none" stroke="${formatInkColor(item.color)}" stroke-width="${formatNumber(item.width, PATH_DECIMALS)}" stroke-linecap="round" stroke-linejoin="round"`
    );
  }
  const { fill, stroke, opacity } = item.paint;
  let attributes = `fill="${fill ? formatInkColor(fill) : "none"}"`;
  if (stroke) {
    attributes +=
      ` stroke="${formatInkColor(stroke.color)}" stroke-width="${formatNumber(stroke.width, PATH_DECIMALS)}"` +
      ` stroke-linecap="${stroke.cap}" stroke-linejoin="${stroke.join}"`;
  }
  if (opacity < 1) attributes += ` opacity="${formatNumber(opacity, PATH_DECIMALS)}"`;
  return pathElement(formatSvgPathData(item.path, PATH_DECIMALS), attributes);
}

export function inkToSvg(doc: InkDocument): string {
  const highlighter: string[] = [];
  const pen: string[] = [];
  for (const item of doc.items) {
    const element = itemElement(item);
    if (element !== null) (inkItemLayer(item) === "highlighter" ? highlighter : pen).push(element);
  }
  return (
    `<svg viewBox="0 0 ${NOTEBOOK_PAGE_COORDINATE_WIDTH} ${NOTEBOOK_PAGE_COORDINATE_HEIGHT}"` +
    ` width="${NOTEBOOK_PAGE_COORDINATE_WIDTH}" height="${NOTEBOOK_PAGE_COORDINATE_HEIGHT}"` +
    ` version="1.1" baseProfile="full" xmlns="http://www.w3.org/2000/svg">` +
    [...highlighter, ...pen].join("") +
    `</svg>`
  );
}
