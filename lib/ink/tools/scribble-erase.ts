/**
 * Which ink a scribble-out gesture takes. Recognising the gesture is
 * `detectNotebookScribble`; this decides what it covered, once it is known to
 * be one, so a scribble over a word takes the word and leaves the underline
 * that merely runs beneath it.
 */

import { inkFlattenPath } from "@/lib/ink/flatten";
import {
  inkBoxesIntersect,
  inkItemBounds,
  type InkBox,
  type InkDocument,
  type InkPathCommand,
  type InkPoint,
} from "@/lib/ink/model";
import { inkShapePath } from "@/lib/ink/shapes";
import {
  getNotebookScribbleCoverage,
  NOTEBOOK_SCRIBBLE_MIN_COVERAGE,
  NOTEBOOK_SCRIBBLE_SMALL_EXTENT,
  NOTEBOOK_SCRIBBLE_SMALL_MIN_COVERAGE,
} from "@/lib/workspace/notebook-scribble-erase";

/**
 * Coverage is a ratio of lengths across a band several nibs wide, so a curve
 * only has to be followed roughly.
 */
const COVERAGE_TOLERANCE = 1.5;

type Band = { hull: InkPoint[]; bounds: InkBox };

function pathCoverage(band: Band, path: readonly InkPathCommand[]): { covered: number; total: number } {
  let covered = 0;
  let total = 0;
  for (const polyline of inkFlattenPath(path, COVERAGE_TOLERANCE)) {
    const points =
      polyline.closed && polyline.points.length > 1 ? [...polyline.points, polyline.points[0]] : polyline.points;
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    // A dot has no length of its own, so weight it by one unit instead of
    // letting it drop out of the average entirely.
    const weight = Math.max(length, 1);
    covered += getNotebookScribbleCoverage(band, points) * weight;
    total += weight;
  }
  return { covered, total };
}

/**
 * The ids, among `candidates`, of the items the scribble swallowed. The band is
 * in page units; `majorExtent` is as `detectNotebookScribble` reports it, and a
 * letter-sized gesture has to cover nearly all of whatever it takes. Items of a
 * kind this build cannot draw are never taken.
 */
export function planInkScribbleErase(input: {
  doc: InkDocument;
  candidates: Iterable<string>;
  band: Band;
  majorExtent: number;
}): string[] {
  const wanted = new Set(input.candidates);
  const minCoverage =
    input.majorExtent < NOTEBOOK_SCRIBBLE_SMALL_EXTENT
      ? NOTEBOOK_SCRIBBLE_SMALL_MIN_COVERAGE
      : NOTEBOOK_SCRIBBLE_MIN_COVERAGE;
  const taken: string[] = [];
  for (const item of input.doc.items) {
    if (!wanted.has(item.id) || item.kind === "unknown") continue;
    if (!inkBoxesIntersect(inkItemBounds(item), input.band.bounds)) continue;
    const path = item.kind === "shape" ? inkShapePath(item.shape, item.width) : item.path;
    const { covered, total } = pathCoverage(input.band, path);
    if (total > 0 && covered / total >= minCoverage) taken.push(item.id);
  }
  return taken;
}
