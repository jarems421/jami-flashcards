import { emptyInkDocument } from "@/lib/ink/model";
import { importJsDrawSvg, type ImportedInk } from "@/lib/ink/import-js-draw-svg";
import { legacyStrokesToJsDrawSvg } from "@/lib/workspace/notebook-ink-data";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  type NotebookStrokeData,
} from "@/lib/workspace/notebooks";

/**
 * Reads v1 stroke data (point lists) through the same conversion the editor
 * uses today, so an old page imports exactly as it renders now.
 */
export function importLegacyStrokes(data: NotebookStrokeData): ImportedInk {
  const svg = legacyStrokesToJsDrawSvg(
    data.strokes,
    NOTEBOOK_PAGE_COORDINATE_WIDTH,
    NOTEBOOK_PAGE_COORDINATE_HEIGHT
  );
  return importJsDrawSvg(svg) ?? { document: emptyInkDocument(), unsupported: [] };
}
