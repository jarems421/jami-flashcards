/**
 * Splitting a notebook page into a light record and a heavy ink record.
 *
 * Ink used to live inside the page document, so opening a notebook fetched
 * every stroke of every page before the editor could draw anything. A page may
 * hold up to `MAX_NOTEBOOK_PAGE_SNAPSHOT_BYTES`, so a long notebook could pull
 * tens of megabytes to show one page.
 *
 * The page record now keeps metadata, text blocks and a bounded thumbnail
 * digest; the ink record holds full-fidelity strokes and SVG and is fetched
 * only for pages actually being drawn.
 *
 * Nothing here performs I/O, and nothing here rewrites saved data. Pages
 * written before the split still carry inline ink, and `mergeNotebookPageInk`
 * treats that inline copy as authoritative so a legacy page opens unchanged.
 */
import type {
  NotebookInkData,
  NotebookPage,
  NotebookStroke,
  NotebookStrokeData,
} from "@/lib/workspace/notebooks";
import { MAX_NOTEBOOK_INK_SVG_LENGTH } from "@/lib/workspace/notebooks";

/**
 * Ink SVG budget for the copy inlined into the page record for thumbnails.
 *
 * A thumbnail renders at roughly 160px wide, so it needs a gist rather than
 * fidelity. Real handwritten pages land far below this; the cap exists so one
 * unusually dense page cannot re-inflate every page record and undo the split.
 */
export const MAX_THUMBNAIL_INK_SVG_LENGTH = 24_000;

/** Strokes kept for the legacy-format thumbnail, matching what it renders. */
export const MAX_THUMBNAIL_STROKES = 10;

/** Points kept per thumbnail stroke. Beyond this the 160px render cannot tell. */
export const MAX_THUMBNAIL_STROKE_POINTS = 12;

export type NotebookPageInkRecord = {
  pageId: string;
  notebookId: string;
  inkData?: NotebookInkData;
  strokeData?: NotebookStrokeData;
  contentRevision: number;
  updatedAt: number;
};

export type NotebookPageThumbnail = {
  /** Present only when the page's SVG fits the thumbnail budget. */
  inkSvg?: string;
  strokes: NotebookStroke[];
  /** True when the page has ink that the digest could not represent. */
  inkOmitted: boolean;
};

/**
 * Evenly samples a stroke down to at most `MAX_THUMBNAIL_STROKE_POINTS`.
 *
 * The endpoints are always kept so a stroke's extent survives; only the
 * detail between them is dropped.
 */
function downsampleStrokePoints(stroke: NotebookStroke): NotebookStroke {
  const { points } = stroke;
  if (points.length <= MAX_THUMBNAIL_STROKE_POINTS) return stroke;

  const step = (points.length - 1) / (MAX_THUMBNAIL_STROKE_POINTS - 1);
  const sampled = Array.from(
    { length: MAX_THUMBNAIL_STROKE_POINTS },
    (_unused, index) => points[Math.round(index * step)]
  );

  return { ...stroke, points: sampled };
}

/**
 * Builds the digest stored on the page record so the pages drawer can render
 * every thumbnail without fetching any ink.
 */
export function buildNotebookPageThumbnail(input: {
  inkData?: NotebookInkData;
  strokeData?: NotebookStrokeData;
}): NotebookPageThumbnail {
  const svg = input.inkData?.svg;
  const withinBudget =
    typeof svg === "string" && svg.length <= MAX_THUMBNAIL_INK_SVG_LENGTH;
  const strokes = (input.strokeData?.strokes ?? [])
    .slice(0, MAX_THUMBNAIL_STROKES)
    .map(downsampleStrokePoints);

  return {
    ...(withinBudget ? { inkSvg: svg } : {}),
    strokes,
    // Only true when there is ink the digest cannot show at all: an oversized
    // SVG with no legacy strokes to fall back on.
    inkOmitted: Boolean(svg) && !withinBudget && strokes.length === 0,
  };
}

/**
 * Separates a page into the record that is always loaded and the ink record
 * that is loaded on demand.
 */
export function splitNotebookPageForPersistence(input: {
  pageId: string;
  notebookId: string;
  inkData?: NotebookInkData;
  strokeData?: NotebookStrokeData;
  contentRevision: number;
  updatedAt: number;
}): {
  thumbnail: NotebookPageThumbnail;
  ink: NotebookPageInkRecord | null;
} {
  const hasInk = Boolean(input.inkData || input.strokeData?.strokes?.length);

  return {
    thumbnail: buildNotebookPageThumbnail(input),
    ink: hasInk
      ? {
          pageId: input.pageId,
          notebookId: input.notebookId,
          ...(input.inkData ? { inkData: input.inkData } : {}),
          ...(input.strokeData ? { strokeData: input.strokeData } : {}),
          contentRevision: input.contentRevision,
          updatedAt: input.updatedAt,
        }
      : null,
  };
}

/**
 * Produces the page the editor works with, given the light record and whatever
 * ink is available for it.
 *
 * A page saved before the split still carries inline ink. That copy is
 * authoritative: it is the only full-fidelity data such a page has, and it is
 * always at least as current as any ink record, because a page cannot have
 * been written in both shapes.
 */
export function mergeNotebookPageInk(
  page: NotebookPage,
  ink: NotebookPageInkRecord | null | undefined
): NotebookPage {
  if (page.inkData || page.strokeData) return page;
  if (!ink) return page;

  return {
    ...page,
    ...(ink.inkData ? { inkData: ink.inkData } : {}),
    ...(ink.strokeData ? { strokeData: ink.strokeData } : {}),
  };
}

/**
 * True when a page still stores its ink inline and would benefit from being
 * rewritten in the split shape the next time it is saved.
 *
 * Conversion is deliberately opportunistic. Rewriting every page in bulk would
 * touch saved work that is not being edited, and a page nobody opens costs
 * nothing to leave alone.
 */
export function needsInkSplitConversion(page: NotebookPage): boolean {
  const inlineSvgLength = page.inkData?.svg.length ?? 0;
  return (
    inlineSvgLength > MAX_THUMBNAIL_INK_SVG_LENGTH ||
    (page.strokeData?.strokes.length ?? 0) > MAX_THUMBNAIL_STROKES
  );
}

/**
 * Guards the ink record against the same limit the page snapshot uses, so the
 * split cannot become a way to store ink that was previously rejected.
 */
export function isNotebookInkRecordWithinLimits(
  ink: NotebookPageInkRecord
): boolean {
  return (ink.inkData?.svg.length ?? 0) <= MAX_NOTEBOOK_INK_SVG_LENGTH;
}
