import type { InkBox } from "@/lib/ink/model";
import { inkBoxesIntersect } from "@/lib/ink/model";
import { NOTEBOOK_PAGE_COORDINATE_HEIGHT, NOTEBOOK_PAGE_COORDINATE_WIDTH } from "@/lib/workspace/notebooks";

const CELL_SIZE = 64;
/** The grid covers two pages before the page origin to three pages past its far edge. */
const GRID_MIN_X = -2 * NOTEBOOK_PAGE_COORDINATE_WIDTH;
const GRID_MAX_X = 3 * NOTEBOOK_PAGE_COORDINATE_WIDTH;
const GRID_MIN_Y = -2 * NOTEBOOK_PAGE_COORDINATE_HEIGHT;
const GRID_MAX_Y = 3 * NOTEBOOK_PAGE_COORDINATE_HEIGHT;
const COLUMNS = Math.ceil((GRID_MAX_X - GRID_MIN_X) / CELL_SIZE);
const ROWS = Math.ceil((GRID_MAX_Y - GRID_MIN_Y) / CELL_SIZE);
/** Anything not wholly inside the grid is also listed here, so it is never lost. */
const OVERFLOW_CELL = -1;

type CellRange = { c0: number; c1: number; r0: number; r1: number; overflow: boolean };

function cellRange(box: InkBox): CellRange {
  const overflow =
    box.minX < GRID_MIN_X || box.maxX > GRID_MAX_X || box.minY < GRID_MIN_Y || box.maxY > GRID_MAX_Y;
  const column = (x: number) =>
    Math.min(COLUMNS - 1, Math.max(0, Math.floor((x - GRID_MIN_X) / CELL_SIZE)));
  const row = (y: number) =>
    Math.min(ROWS - 1, Math.max(0, Math.floor((y - GRID_MIN_Y) / CELL_SIZE)));
  return {
    c0: column(box.minX),
    c1: column(box.maxX),
    r0: row(box.minY),
    r1: row(box.maxY),
    overflow,
  };
}

/**
 * A uniform grid over page space for hit tests and tile queries, so erasing,
 * selecting and redrawing a region look only at nearby items instead of the
 * whole page. Boxes off the page are clamped into the edge cells and also
 * tracked in an overflow bucket, so they still work however far out they go.
 * Queries are exact: a candidate is returned only if its box really meets the
 * query box.
 */
export class InkSpatialIndex {
  private readonly boxes = new Map<string, InkBox>();
  private readonly cells = new Map<number, Set<string>>();

  get size(): number {
    return this.boxes.size;
  }

  set(id: string, box: InkBox): void {
    if (this.boxes.has(id)) this.delete(id);
    this.boxes.set(id, box);
    this.forEachCell(box, (key) => {
      let cell = this.cells.get(key);
      if (!cell) {
        cell = new Set();
        this.cells.set(key, cell);
      }
      cell.add(id);
    });
  }

  delete(id: string): void {
    const box = this.boxes.get(id);
    if (!box) return;
    this.boxes.delete(id);
    this.forEachCell(box, (key) => {
      const cell = this.cells.get(key);
      if (!cell) return;
      cell.delete(id);
      if (cell.size === 0) this.cells.delete(key);
    });
  }

  /** Ids of every item whose box meets `box`, each once, in no set order. */
  query(box: InkBox): string[] {
    const found = new Set<string>();
    this.forEachCell(box, (key) => {
      const cell = this.cells.get(key);
      if (!cell) return;
      for (const id of cell) {
        const candidate = this.boxes.get(id);
        if (candidate && inkBoxesIntersect(candidate, box)) found.add(id);
      }
    });
    return Array.from(found);
  }

  clear(): void {
    this.boxes.clear();
    this.cells.clear();
  }

  private forEachCell(box: InkBox, visit: (key: number) => void): void {
    const range = cellRange(box);
    for (let r = range.r0; r <= range.r1; r += 1) {
      for (let c = range.c0; c <= range.c1; c += 1) visit(r * COLUMNS + c);
    }
    if (range.overflow) visit(OVERFLOW_CELL);
  }
}
