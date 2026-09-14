import { describe, expect, it, vi } from "vitest";
import {
  captureExamWorking,
  EXAM_WORKING_MAX_IMAGE_SIDE,
  EXAM_WORKING_MAX_PAGES,
  examWorkingHasInk,
  examWorkingPagesWithInk,
  examWorkingStackLayout,
  requireExamWorkingSnapshot,
} from "@/lib/practice/exam-working";

/** What js-draw hands back for a sheet nobody has drawn on. */
const EMPTY_SHEET =
  '<svg viewBox="0 0 900 1240" width="900" height="1240" class="js-draw" ' +
  'xmlns="http://www.w3.org/2000/svg"><style>path{fill:none}</style></svg>';
const INKED_SHEET =
  '<svg viewBox="0 0 900 1240" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M10,10 L90,90" stroke="#000"/></svg>';
const SECOND_INKED_SHEET =
  '<svg viewBox="0 0 900 1240" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M20,20 L80,80" stroke="#000"/></svg>';

/**
 * An empty sheet is not an empty string, and undo depth is not ink.
 *
 * The editor serialises its own wrapper whether or not anything is on it, so
 * "the string is non-empty" called every blank sheet ink: a blank image was
 * submitted as working, the attempt was recorded as carrying working, and the
 * image was paid for on the way to the marker. Undo depth fails the opposite
 * way -- a stroke drawn and then erased leaves history and a blank page.
 */
describe("deciding whether a sheet has ink on it", () => {
  it("reads an untouched sheet as empty despite its wrapper", () => {
    expect(examWorkingHasInk(EMPTY_SHEET)).toBe(false);
  });

  it("reads a drawn sheet as inked", () => {
    expect(examWorkingHasInk(INKED_SHEET)).toBe(true);
  });

  it("ignores the metadata the editor writes beside the drawing", () => {
    const decorated =
      '<svg viewBox="0 0 900 1240"><style>path{fill:none}</style>' +
      "<metadata><x>1</x></metadata><defs><clipPath id=\"c\"><rect/></clipPath></defs>" +
      "<title>Working</title><desc>A sheet</desc></svg>";
    expect(examWorkingHasInk(decorated)).toBe(false);
  });

  it("is not fooled by a comment or by stray text", () => {
    expect(examWorkingHasInk('<svg><!-- <path d="M0,0"/> --></svg>')).toBe(false);
    expect(examWorkingHasInk("<svg>ink</svg>")).toBe(false);
  });

  it("treats nothing at all as empty", () => {
    expect(examWorkingHasInk("")).toBe(false);
    expect(examWorkingHasInk(null)).toBe(false);
    expect(examWorkingHasInk(undefined)).toBe(false);
  });
});

describe("several pages of working", () => {
  it("keeps only the pages with something on them, in order", () => {
    expect(
      examWorkingPagesWithInk([INKED_SHEET, EMPTY_SHEET, "", SECOND_INKED_SHEET])
    ).toEqual([INKED_SHEET, SECOND_INKED_SHEET]);
  });

  it("sends a single page at full size", () => {
    expect(
      examWorkingStackLayout({ pageCount: 1, pageWidth: 1200, pageHeight: 1653, gap: 24 })
    ).toEqual({ width: 1200, height: 1653, pageHeight: 1653, offsets: [0] });
  });

  /*
   * The server refuses an image taller than its limit, so a long piece of
   * working has to fit inside it rather than be turned away at submission.
   */
  it("fits the most pages allowed inside the server's size limit", () => {
    const layout = examWorkingStackLayout({
      pageCount: EXAM_WORKING_MAX_PAGES,
      pageWidth: 1200,
      pageHeight: 1653,
      gap: 24,
    });
    expect(layout.height).toBeLessThanOrEqual(EXAM_WORKING_MAX_IMAGE_SIDE);
    expect(layout.width).toBeLessThanOrEqual(EXAM_WORKING_MAX_IMAGE_SIDE);
    expect(layout.offsets).toHaveLength(EXAM_WORKING_MAX_PAGES);
    // Each page follows the one before it without overlapping it.
    for (let index = 1; index < layout.offsets.length; index += 1) {
      expect(layout.offsets[index]! - layout.offsets[index - 1]!).toBeGreaterThanOrEqual(
        layout.pageHeight
      );
    }
    // Scaled by the same factor on both axes, so no page is squashed.
    expect(layout.width / layout.pageHeight).toBeCloseTo(1200 / 1653, 2);
  });
});

describe("working must be known before submission", () => {
  it.each([null, undefined])("refuses an unavailable serializer result: %s", async (pages) => {
    const save = vi.fn();
    const rasterize = vi.fn();
    expect(await captureExamWorking({ serialize: async () => pages, save, rasterize }))
      .toEqual({ hasInk: false, ok: false, reason: "not_ready" });
    expect(save).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
  });

  it("allows a confirmed empty sheet", async () => {
    const rasterize = vi.fn();
    expect(await captureExamWorking({ serialize: async () => [""], save: vi.fn(), rasterize }))
      .toEqual({ hasInk: false, ok: true });
    expect(rasterize).not.toHaveBeenCalled();
  });

  /** The blank sheet that used to be rasterised, submitted and marked. */
  it("does not submit untouched pages as working", async () => {
    const rasterize = vi.fn();
    const save = vi.fn();
    expect(
      await captureExamWorking({ serialize: async () => [EMPTY_SHEET, EMPTY_SHEET], save, rasterize })
    ).toEqual({ hasInk: false, ok: true });
    expect(rasterize).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("includes loaded ink even without undo history, despite a failed draft save", async () => {
    const png = { mimeType: "image/png" as const, dataBase64: "ink", width: 1200, height: 1653 };
    const rasterize = vi.fn().mockResolvedValue(png);
    expect(await captureExamWorking({ serialize: async () => [INKED_SHEET],
      save: vi.fn().mockRejectedValue(new Error("offline")), rasterize }))
      .toEqual({ hasInk: true, ok: true, png });
    expect(rasterize).toHaveBeenCalledWith([INKED_SHEET]);
  });

  it("saves every page but rasterises only the ones with ink", async () => {
    const png = { mimeType: "image/png" as const, dataBase64: "ink", width: 1200, height: 3330 };
    const save = vi.fn().mockResolvedValue(undefined);
    const rasterize = vi.fn().mockResolvedValue(png);
    const pages = [INKED_SHEET, EMPTY_SHEET, SECOND_INKED_SHEET];
    await captureExamWorking({ serialize: async () => pages, save, rasterize });
    expect(save).toHaveBeenCalledWith(pages);
    expect(rasterize).toHaveBeenCalledWith([INKED_SHEET, SECOND_INKED_SHEET]);
  });

  it("blocks a failed image conversion", async () => {
    const snapshot = await captureExamWorking({ serialize: async () => [INKED_SHEET],
      save: vi.fn().mockResolvedValue(undefined), rasterize: vi.fn().mockResolvedValue(undefined) });
    expect(snapshot).toEqual({ hasInk: true, ok: false, reason: "image_failed" });
    await expect(requireExamWorkingSnapshot({ id: "a", status: "draft" },
      { attemptId: "a", snapshot: async () => snapshot })).rejects.toThrow("not been submitted");
  });

  it("blocks missing, stale and still-loading handles", async () => {
    const attempt = { id: "a", status: "draft" };
    await expect(requireExamWorkingSnapshot(attempt, null)).rejects.toThrow("not ready");
    const snapshot = vi.fn();
    await expect(requireExamWorkingSnapshot(attempt, { attemptId: "old", snapshot })).rejects.toThrow("not ready");
    expect(snapshot).not.toHaveBeenCalled();
    snapshot.mockResolvedValue({ ok: false, hasInk: false, reason: "not_ready" });
    await expect(requireExamWorkingSnapshot(attempt, { attemptId: "a", snapshot })).rejects.toThrow("not ready");
  });

  it("lets a typed-only answer through once the sheet is confirmed empty", async () => {
    const snapshot = async () => await captureExamWorking({
      serialize: async () => [EMPTY_SHEET], save: vi.fn(), rasterize: vi.fn(),
    });
    expect(await requireExamWorkingSnapshot({ id: "a", status: "draft" }, { attemptId: "a", snapshot }))
      .toEqual({ hasInk: false, ok: true });
  });

  it("retries failed marking without consulting or replacing frozen working", async () => {
    const snapshot = vi.fn();
    expect(await requireExamWorkingSnapshot({ id: "a", status: "marking_failed" },
      { attemptId: "a", snapshot })).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled();
  });
});
