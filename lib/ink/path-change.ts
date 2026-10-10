/**
 * Where a path changed between two versions of it: the box live ink must
 * repaint when a stroke's geometry is recomputed for a new packet.
 *
 * Live ink still paints the whole stroke on every packet (the pen's widths
 * depend on the whole stroke, so nothing is assumed frozen); this only says
 * where the result can differ from the last packet's, so the repaint can be
 * clipped there. A pixel's colour depends only on the geometry that crosses
 * it, so outside this box the new paint and the old are the same pixels.
 *
 * The comparison is by command: whatever two versions share at the start and
 * at the end is unchanged, and the box covers the rest, of both versions.
 * Three things widen it:
 *
 * - a command after the shared start begins where the previous one ended, so
 *   that point is included;
 * - the first shared command at the end begins where a changed one ended, so
 *   it is included whole;
 * - a filled subpath is closed by an unseen line from its last point back to
 *   its start, so when its last point changes, its start is included.
 *
 * Subpaths that are wholly added, removed or changed are covered whole, and a
 * `Z` in the middle of a subpath gives up and covers both paths. DOM-free.
 */

import type { InkBox, InkPathCommand } from "@/lib/ink/model";

export type InkPathChange =
  /** Both versions draw exactly the same. */
  | { kind: "none" }
  /** Differences are confined to `box` (page units, before stroke width). */
  | { kind: "box"; box: InkBox }
  /** Nothing narrower can be said. */
  | { kind: "all" };

type Subpath = readonly InkPathCommand[];

/** The same command with the same numbers. */
export function sameInkPathCommand(a: InkPathCommand, b: InkPathCommand): boolean {
  if (a === b) return true;
  if (a.op !== b.op) return false;
  switch (a.op) {
    case "Z":
      return true;
    case "M":
    case "L":
      return b.op === a.op && a.x === b.x && a.y === b.y;
    case "Q":
      return b.op === "Q" && a.x1 === b.x1 && a.y1 === b.y1 && a.x === b.x && a.y === b.y;
    case "C":
      return (
        b.op === "C" &&
        a.x1 === b.x1 &&
        a.y1 === b.y1 &&
        a.x2 === b.x2 &&
        a.y2 === b.y2 &&
        a.x === b.x &&
        a.y === b.y
      );
  }
}

/** The same commands with the same numbers; the same array is answered at once. */
export function sameInkPath(a: readonly InkPathCommand[], b: readonly InkPathCommand[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!sameInkPathCommand(a[i], b[i])) return false;
  return true;
}

/** Splits at each move; anything before the first move is a subpath of its own. */
function subpaths(commands: readonly InkPathCommand[]): Subpath[] {
  const result: InkPathCommand[][] = [];
  for (const command of commands) {
    if (command.op === "M" || result.length === 0) result.push([]);
    result[result.length - 1].push(command);
  }
  return result;
}

class Hull {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  point(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  command(command: InkPathCommand | undefined): void {
    if (!command) return;
    switch (command.op) {
      case "Z":
        return;
      case "M":
      case "L":
        this.point(command.x, command.y);
        return;
      case "Q":
        this.point(command.x1, command.y1);
        this.point(command.x, command.y);
        return;
      case "C":
        this.point(command.x1, command.y1);
        this.point(command.x2, command.y2);
        this.point(command.x, command.y);
        return;
    }
  }

  /** Where a command leaves the pen; a Z returns it to the subpath's start. */
  end(command: InkPathCommand | undefined, start: InkPathCommand): void {
    if (!command) return;
    if (command.op === "Z") this.command(start);
    else this.point(command.x, command.y);
  }

  all(commands: readonly InkPathCommand[]): void {
    for (const command of commands) this.command(command);
  }

  box(): InkBox | null {
    return this.maxX >= this.minX ? { minX: this.minX, minY: this.minY, maxX: this.maxX, maxY: this.maxY } : null;
  }
}

const hasInnerClose = (subpath: Subpath) => subpath.some((command, i) => command.op === "Z" && i < subpath.length - 1);

/** One subpath changed: compare its commands. */
function subpathChange(before: Subpath, after: Subpath, filled: boolean, hull: Hull): boolean {
  if (hasInnerClose(before) || hasInnerClose(after) || before[0]?.op !== "M" || !sameInkPathCommand(before[0], after[0])) {
    hull.all(before);
    hull.all(after);
    return true;
  }
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && sameInkPathCommand(before[start], after[start])) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    sameInkPathCommand(before[before.length - 1 - end], after[after.length - 1 - end])
  ) {
    end += 1;
  }
  // The point the first changed command starts from.
  hull.end(before[start - 1], before[0]);
  for (let i = start; i < before.length - end; i += 1) hull.command(before[i]);
  for (let i = start; i < after.length - end; i += 1) hull.command(after[i]);
  if (end > 0) {
    // It starts where a changed command ended, so it moved too; a closing Z
    // runs back to the subpath's start.
    const next = after[after.length - end];
    hull.command(next.op === "Z" ? before[0] : next);
  } else if (filled) {
    // The last point moved, and with it the unseen closing line.
    hull.command(before[0]);
  }
  return true;
}

/**
 * Where `after` can paint differently from `before`. `filled` says whether
 * the path is filled (closing lines count) or only stroked.
 */
export function inkPathChange(
  before: readonly InkPathCommand[],
  after: readonly InkPathCommand[],
  filled: boolean
): InkPathChange {
  if (before === after) return { kind: "none" };
  const a = subpaths(before);
  const b = subpaths(after);
  const shortest = Math.min(a.length, b.length);
  let start = 0;
  while (start < shortest && sameInkPath(a[start], b[start])) start += 1;
  let end = 0;
  while (end < shortest - start && sameInkPath(a[a.length - 1 - end], b[b.length - 1 - end])) end += 1;
  const changedBefore = a.slice(start, a.length - end);
  const changedAfter = b.slice(start, b.length - end);
  if (changedBefore.length === 0 && changedAfter.length === 0) return { kind: "none" };
  const hull = new Hull();
  if (changedBefore.length === 1 && changedAfter.length === 1) {
    subpathChange(changedBefore[0], changedAfter[0], filled, hull);
  } else {
    for (const subpath of changedBefore) hull.all(subpath);
    for (const subpath of changedAfter) hull.all(subpath);
  }
  const box = hull.box();
  return box ? { kind: "box", box } : { kind: "all" };
}
