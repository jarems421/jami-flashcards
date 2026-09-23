import { compactNotebookInkSvg } from "@/lib/workspace/notebook-ink-compaction";

export type ExamScratchpadSnapshot = {
  hasInk: boolean;
  ok: boolean;
  reason?: "not_ready" | "image_failed";
  png?: { mimeType: "image/png"; dataBase64: string; width: number; height: number };
};

export type ExamScratchpadHandle = {
  attemptId: string;
  snapshot(): Promise<ExamScratchpadSnapshot>;
};

/** The server refuses a working image wider or taller than this. */
export const EXAM_WORKING_MAX_IMAGE_SIDE = 4096;

/**
 * How wide one page has to be drawn for the handwriting on it to be readable.
 *
 * An A4 page at 960px is about 115 pixels to the inch, which is roughly what a
 * phone camera photograph of a page gives a marker and comfortably enough for
 * joined handwriting. Below about 700 the descenders of one line start meeting
 * the ascenders of the next and a model begins guessing at words.
 */
export const EXAM_WORKING_LEGIBLE_PAGE_WIDTH = 960;

/**
 * Whether a serialised sheet actually has anything drawn on it.
 *
 * An empty editor does not serialise to an empty string: it returns its own
 * `<svg ...></svg>` wrapper, which is truthy, so "is this string non-empty"
 * called every blank sheet ink -- submitting a blank image as working, marking
 * the attempt as carrying working, and paying to send the image to the marker.
 * Undo depth fails the other way round: a stroke drawn and then erased leaves
 * two history entries and nothing on the page.
 *
 * So the content is read instead. The wrapper and the metadata js-draw writes
 * beside it come out, and any element that survives is something a student put
 * there.
 */
const WRAPPER_ELEMENTS = /<(style|metadata|defs|title|desc)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const SELF_CLOSED_WRAPPERS = /<(style|metadata|defs|title|desc)\b[^>]*\/>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

export function examWorkingHasInk(svg: string | null | undefined): boolean {
  if (!svg) return false;
  const body = svg
    .replace(COMMENTS, "")
    .replace(WRAPPER_ELEMENTS, "")
    .replace(SELF_CLOSED_WRAPPERS, "")
    .replace(/<svg\b[^>]*>/i, "")
    .replace(/<\/svg\s*>/i, "");
  return /<[a-zA-Z]/.test(body);
}

/** The pages worth sending, in order: a blank page adds nothing to mark. */
export function examWorkingPagesWithInk(pages: readonly string[]) {
  return pages.filter((page) => examWorkingHasInk(page));
}

/**
 * The same, keeping each page's place on the sheet.
 *
 * A sheet's pages are no longer interchangeable. Page three may be the third
 * printed page of the question and page four the first blank sheet after it,
 * so the position a page was drawn at is what says where its ink was written
 * -- and dropping the blank pages between them loses exactly that.
 */
export function examWorkingInkedPages(pages: readonly string[]) {
  return pages.flatMap((svg, index) => (examWorkingHasInk(svg) ? [{ index, svg }] : []));
}

export type ExamWorkingInkedPage = { index: number; svg: string };

/**
 * Pages as they are stored: the same drawing with fewer points in it.
 *
 * The notebook compacts ink before storing it and a sheet of working never
 * did, so a busy sheet stayed at full density -- slower to redraw every time it
 * was opened, and closer to the size at which it can no longer be saved. Only
 * the stored copy is compacted; what the marker is sent is rasterised from the
 * editor's own export. A page that does not come out smaller, or that the
 * compactor cannot read, is kept exactly as it was.
 */
export function compactExamWorkingPages(pages: readonly string[]): string[] {
  return pages.map((page) => {
    if (!page) return page;
    try {
      const compacted = compactNotebookInkSvg(page).svg;
      return compacted.length < page.length ? compacted : page;
    } catch {
      return page;
    }
  });
}

/**
 * Where the sheet's zoom buttons step to, as multiples of the fitted page. The
 * first is the fit itself; a pinch can land anywhere in between.
 *
 * The page's fit, pan and pinch are the notebook's viewport's own -- see
 * `useNotebookViewportController`. So is the rule for telling a palm from a
 * finger: touch is ignored while the Pencil is down and just after it lifts.
 * The sheet used to judge that by contact size instead, and iPadOS reports a
 * fingertip at around the size it took for a palm.
 */
export const EXAM_WORKING_ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

export type ExamWorkingSheetPage = {
  /** The page's own size, in the sheet's coordinates. */
  width: number;
  height: number;
  /** What this page is, written above it so a marker can place the ink. */
  caption: string;
};

export type ExamWorkingSheetSlot = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The band above the page that carries its caption. */
  captionTop: number;
  captionHeight: number;
};

/**
 * Where each page sits in the single image a submission carries.
 *
 * Marking, the check, the Tutor and the notebook copy all read one working
 * image, so the pages are laid out into one rather than sent as several.
 *
 * They used to be stacked in a single column, which was right while a sheet
 * was four small blank pads and wrong the moment it became the paper itself.
 * A question can now run to several printed pages plus the answer space the
 * board left after it, and six A4 pages in one column is 8,500 pixels tall --
 * so the whole thing was scaled to fit a 4,096 limit, and every page arrived
 * at under half the width handwriting can be read at.
 *
 * So the pages are laid out in columns instead. The number of columns is the
 * one that leaves each page widest inside the limit, which for one or two
 * pages is still a single column and for six is three. Reading order is left
 * to right then down, and never has to be inferred: each page is captioned
 * with what it is.
 */
export function examWorkingSheetLayout(input: {
  pages: readonly ExamWorkingSheetPage[];
  gap: number;
  captionHeight: number;
  maxSide?: number;
  /** For tests, and for a sheet whose pages are already small. */
  maxPageWidth?: number;
}) {
  const maxSide = input.maxSide ?? EXAM_WORKING_MAX_IMAGE_SIDE;
  const pages = input.pages.length ? input.pages : [{ width: 1, height: 1, caption: "" }];
  const cellWidth = Math.max(...pages.map((page) => page.width));
  const maxPageWidth = input.maxPageWidth ?? EXAM_WORKING_LEGIBLE_PAGE_WIDTH;

  /** The grid for a given number of columns, at natural size. */
  const plan = (columns: number) => {
    const rows: number[][] = [];
    for (let index = 0; index < pages.length; index += columns) {
      rows.push(pages.slice(index, index + columns).map((_page, offset) => index + offset));
    }
    const rowHeights = rows.map((row) =>
      Math.max(...row.map((index) => pages[index].height)) + input.captionHeight
    );
    const width = columns * cellWidth + (columns - 1) * input.gap;
    const height =
      rowHeights.reduce((sum, value) => sum + value, 0) + (rows.length - 1) * input.gap;
    return { columns, rows, rowHeights, width, height };
  };

  /*
   * Not clamped at 1. Ink is stored as vector markup, so drawing a page larger
   * than its own coordinates costs nothing and loses nothing -- and a sheet's
   * coordinate width is 900, just under the width handwriting wants. The cap
   * that matters is the legible width below, which this is then held to.
   */
  let best = plan(1);
  let bestScale = Math.min(maxSide / best.width, maxSide / best.height);
  for (let columns = 2; columns <= pages.length; columns += 1) {
    const candidate = plan(columns);
    const scale = Math.min(maxSide / candidate.width, maxSide / candidate.height);
    // Strictly wider only: a tie keeps the fewest columns, which keeps the
    // simplest reading order.
    if (scale > bestScale + 1e-9) {
      best = candidate;
      bestScale = scale;
    }
  }

  const scale = Math.min(bestScale, maxPageWidth / cellWidth);
  const gap = best.columns > 1 || best.rows.length > 1 ? Math.floor(input.gap * scale) : 0;
  const captionHeight = Math.floor(input.captionHeight * scale);
  const drawnCellWidth = Math.floor(cellWidth * scale);

  const slots: ExamWorkingSheetSlot[] = new Array(pages.length);
  let top = 0;
  best.rows.forEach((row, rowIndex) => {
    const rowHeight = Math.floor((best.rowHeights[rowIndex] - input.captionHeight) * scale);
    row.forEach((pageIndex, column) => {
      const page = pages[pageIndex];
      const width = Math.floor(page.width * scale);
      const height = Math.floor(page.height * scale);
      slots[pageIndex] = {
        // Centred in its column, so a short crop and a full page share an axis.
        left: column * (drawnCellWidth + gap) + Math.floor((drawnCellWidth - width) / 2),
        top: top + captionHeight,
        width,
        height,
        captionTop: top,
        captionHeight,
      };
    });
    top += captionHeight + rowHeight + gap;
  });

  return {
    width: best.columns * drawnCellWidth + (best.columns - 1) * gap,
    height: Math.max(0, top - gap),
    scale,
    slots,
  };
}

/** A missing/unready editor is not evidence of an empty sheet. */
export async function captureExamWorking(input: {
  serialize(): Promise<readonly string[] | null | undefined>;
  save(pages: readonly string[]): Promise<unknown>;
  rasterize(pages: readonly ExamWorkingInkedPage[]): Promise<ExamScratchpadSnapshot["png"]>;
}): Promise<ExamScratchpadSnapshot> {
  const pages = await input.serialize();
  if (pages == null) return { hasInk: false, ok: false, reason: "not_ready" };
  const inked = examWorkingInkedPages(pages);
  if (inked.length === 0) return { hasInk: false, ok: true };
  // The frozen PNG is submitted even if the separate draft save is offline.
  await input.save(pages).catch(() => undefined);
  const png = await input.rasterize(inked);
  return png ? { hasInk: true, ok: true, png }
    : { hasInk: true, ok: false, reason: "image_failed" };
}

export async function requireExamWorkingSnapshot(
  attempt: { id: string; status: string },
  handle: ExamScratchpadHandle | null,
): Promise<ExamScratchpadSnapshot | undefined> {
  // The server reuses frozen evidence; never replace it with the live pad.
  if (attempt.status === "marking_failed") return undefined;
  const snapshot = handle?.attemptId === attempt.id ? await handle.snapshot() : undefined;
  if (!snapshot?.ok) {
    throw new Error(snapshot?.reason === "image_failed"
      ? "Your working could not be prepared for marking. Please try again — your answer has not been submitted."
      : "Your working sheet is not ready yet. Open Working and let it load, then try again.");
  }
  return snapshot;
}
