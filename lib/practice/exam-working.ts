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

/** A missing/unready editor is not evidence of an empty sheet. */
export async function captureExamWorking(input: {
  serialize(): Promise<string | null | undefined>;
  save(svg: string): Promise<unknown>;
  rasterize(svg: string): Promise<ExamScratchpadSnapshot["png"]>;
}): Promise<ExamScratchpadSnapshot> {
  const svg = await input.serialize();
  if (svg == null) return { hasInk: false, ok: false, reason: "not_ready" };
  const hasInk = examWorkingHasInk(svg);
  if (!hasInk) return { hasInk: false, ok: true };
  // The frozen PNG is submitted even if the separate draft save is offline.
  await input.save(svg).catch(() => undefined);
  const png = await input.rasterize(svg);
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
