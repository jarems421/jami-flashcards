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

/**
 * Pages of working a question can hold.
 *
 * Enough for a long calculation or an extended answer, and few enough that
 * every page still reads at a legible size once they are stacked into the one
 * image the marker is sent.
 */
export const EXAM_WORKING_MAX_PAGES = 4;

/** The server refuses a working image wider or taller than this. */
export const EXAM_WORKING_MAX_IMAGE_SIDE = 4096;

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
 * Zoom levels on the full-screen sheet, as multiples of the page fitted to the
 * screen. The first is the fit itself.
 */
export const EXAM_WORKING_ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

/** The widest a page can be drawn and still be seen whole, inside some padding. */
export function examWorkingFitWidth(input: {
  containerWidth: number;
  containerHeight: number;
  pageWidth: number;
  pageHeight: number;
  padding: number;
}) {
  const width = Math.max(0, input.containerWidth - input.padding * 2);
  const height = Math.max(0, input.containerHeight - input.padding * 2);
  if (input.pageWidth <= 0 || input.pageHeight <= 0) return 0;
  return Math.floor(Math.min(width, (height * input.pageWidth) / input.pageHeight));
}

/** Contacts wider than this, in CSS pixels, are a resting hand rather than a fingertip. */
export const EXAM_WORKING_PALM_CONTACT_SIZE = 40;

export function examWorkingTouchIsPalm(contact: { width: number; height: number }) {
  return Math.max(contact.width, contact.height) > EXAM_WORKING_PALM_CONTACT_SIZE;
}

/**
 * Where each page sits in the single image a submission carries.
 *
 * Marking, the check, the Tutor and the notebook copy all read one working
 * image, so several pages are stacked top to bottom rather than sent as
 * several. Scaled down only as far as the server's size limit needs; the
 * heights are floored so the stack can never round past it.
 */
export function examWorkingStackLayout(input: {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  gap: number;
  maxSide?: number;
}) {
  const maxSide = input.maxSide ?? EXAM_WORKING_MAX_IMAGE_SIDE;
  const count = Math.max(1, Math.round(input.pageCount));
  const naturalHeight = count * input.pageHeight + (count - 1) * input.gap;
  const scale = Math.min(1, maxSide / naturalHeight, maxSide / input.pageWidth);
  const width = Math.floor(input.pageWidth * scale);
  const pageHeight = Math.floor(input.pageHeight * scale);
  const gap = count > 1 ? Math.floor(input.gap * scale) : 0;
  return {
    width,
    height: count * pageHeight + (count - 1) * gap,
    pageHeight,
    offsets: Array.from({ length: count }, (_unused, index) => index * (pageHeight + gap)),
  };
}

/** A missing/unready editor is not evidence of an empty sheet. */
export async function captureExamWorking(input: {
  serialize(): Promise<readonly string[] | null | undefined>;
  save(pages: readonly string[]): Promise<unknown>;
  rasterize(pages: readonly string[]): Promise<ExamScratchpadSnapshot["png"]>;
}): Promise<ExamScratchpadSnapshot> {
  const pages = await input.serialize();
  if (pages == null) return { hasInk: false, ok: false, reason: "not_ready" };
  const inked = examWorkingPagesWithInk(pages);
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
