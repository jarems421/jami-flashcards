import { describe, expect, it, vi } from "vitest";
import {
  captureExamWorking,
  compactExamWorkingPages,
  EXAM_WORKING_LEGIBLE_PAGE_WIDTH,
  EXAM_WORKING_MAX_IMAGE_SIDE,
  examWorkingFitWidth,
  examWorkingHasInk,
  examWorkingInkedPages,
  examWorkingPagesWithInk,
  examWorkingSheetLayout,
  examWorkingTouchIsPalm,
  requireExamWorkingSnapshot,
} from "@/lib/practice/exam-working";
import { EXAM_SHEET_MAX_PAGES } from "@/lib/practice/exam-question-sheet";

/** An A4 page at the sheet's own width, which is what most pages are. */
const A4 = { width: 900, height: 1273, caption: "Q1 — written on the printed page" };
const sheetOf = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({ ...A4, caption: `page ${index + 1}` }));

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
 * What is stored for a sheet: the notebook's compaction, which a sheet of
 * working never had, so busy pages stayed at full density.
 */
describe("storing a sheet of working", () => {
  const sheet = (paths: string) =>
    `<svg viewBox="0 0 900 1240"><style id="js-draw-style-sheet">path{fill:none}</style>${paths}</svg>`;

  it("keeps the ink and stores fewer points for a densely sampled stroke", () => {
    const out = Array.from({ length: 40 }, (_, i) => `L ${i} 0`).join(" ");
    const back = Array.from({ length: 40 }, (_, i) => `L ${39 - i} 3`).join(" ");
    const dense = sheet(`<path d="M 0 0 ${out} ${back} Z" fill="#111827"/>`);

    const [stored] = compactExamWorkingPages([dense]);

    expect(stored.length).toBeLessThan(dense.length);
    expect(examWorkingHasInk(stored)).toBe(true);
  });

  it("leaves blank pages and curves exactly as they were", () => {
    const curved = sheet('<path d="M 0 0 C 1 1 2 2 3 3"/>');
    expect(compactExamWorkingPages(["", EMPTY_SHEET, curved])).toEqual(["", EMPTY_SHEET, curved]);
  });
});

/**
 * The full-screen sheet: the whole page on screen at its fit, and a resting
 * hand told apart from a finger that means to scroll.
 */
describe("fitting and handling the full-screen sheet", () => {
  it("fits a tall page by its height on a wide screen", () => {
    expect(
      examWorkingFitWidth({ containerWidth: 1180, containerHeight: 740, pageWidth: 900, pageHeight: 1240, padding: 16 })
    ).toBe(Math.floor(((740 - 32) * 900) / 1240));
  });

  it("fits by width on a narrow screen", () => {
    expect(
      examWorkingFitWidth({ containerWidth: 390, containerHeight: 800, pageWidth: 900, pageHeight: 1240, padding: 16 })
    ).toBe(358);
  });

  it("never reports a negative or undefined size", () => {
    expect(
      examWorkingFitWidth({ containerWidth: 10, containerHeight: 10, pageWidth: 900, pageHeight: 1240, padding: 16 })
    ).toBe(0);
    expect(
      examWorkingFitWidth({ containerWidth: 500, containerHeight: 500, pageWidth: 0, pageHeight: 1240, padding: 16 })
    ).toBe(0);
  });

  it("ignores a contact the size of a hand, and not a fingertip", () => {
    expect(examWorkingTouchIsPalm({ width: 22, height: 24 })).toBe(false);
    expect(examWorkingTouchIsPalm({ width: 64, height: 48 })).toBe(true);
  });
});

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

  it("keeps each page's place on the sheet, so its caption can name it", () => {
    expect(
      examWorkingInkedPages([EMPTY_SHEET, INKED_SHEET, "", SECOND_INKED_SHEET])
    ).toEqual([
      { index: 1, svg: INKED_SHEET },
      { index: 3, svg: SECOND_INKED_SHEET },
    ]);
  });

  it("sends a single page in one column, at the width handwriting reads at", () => {
    const layout = examWorkingSheetLayout({ pages: [A4], gap: 28, captionHeight: 48 });
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0]!.left).toBe(0);
    // The caption band sits above the page rather than over it.
    expect(layout.slots[0]!.top).toBe(layout.slots[0]!.captionHeight);
    expect(layout.width).toBe(EXAM_WORKING_LEGIBLE_PAGE_WIDTH);
  });

  /*
   * The point of the columns. Six A4 pages stacked is over 8,000 pixels tall,
   * so a single column had to be scaled to under half the width handwriting
   * can be read at just to fit the server's limit.
   */
  it("keeps six pages readable by laying them out in columns", () => {
    const layout = examWorkingSheetLayout({ pages: sheetOf(6), gap: 28, captionHeight: 48 });
    expect(layout.height).toBeLessThanOrEqual(EXAM_WORKING_MAX_IMAGE_SIDE);
    expect(layout.width).toBeLessThanOrEqual(EXAM_WORKING_MAX_IMAGE_SIDE);
    expect(layout.slots[0]!.width).toBeGreaterThan(700);
    // Reading order is left to right, then down.
    expect(layout.slots[1]!.left).toBeGreaterThan(layout.slots[0]!.left);
    expect(layout.slots[1]!.top).toBe(layout.slots[0]!.top);
  });

  it("fits a whole sheet of pages inside the server's size limit", () => {
    const layout = examWorkingSheetLayout({
      pages: sheetOf(EXAM_SHEET_MAX_PAGES),
      gap: 28,
      captionHeight: 48,
    });
    expect(layout.slots).toHaveLength(EXAM_SHEET_MAX_PAGES);
    expect(layout.height).toBeLessThanOrEqual(EXAM_WORKING_MAX_IMAGE_SIDE);
    expect(layout.width).toBeLessThanOrEqual(EXAM_WORKING_MAX_IMAGE_SIDE);
    // Every page is drawn, and no two of them overlap.
    for (const [index, slot] of layout.slots.entries()) {
      expect(slot.width).toBeGreaterThan(0);
      expect(slot.height).toBeGreaterThan(0);
      for (const other of layout.slots.slice(index + 1)) {
        const apart =
          slot.left + slot.width <= other.left ||
          other.left + other.width <= slot.left ||
          slot.top + slot.height <= other.captionTop ||
          other.top + other.height <= slot.captionTop;
        expect(apart).toBe(true);
      }
    }
  });

  /** A crop that is a third of a page tall keeps its own shape beside a full one. */
  it("scales every page by one factor and centres the short ones", () => {
    const layout = examWorkingSheetLayout({
      pages: [A4, { width: 900, height: 420, caption: "extra" }],
      gap: 28,
      captionHeight: 48,
    });
    const [full, stub] = layout.slots;
    expect(full!.width).toBe(stub!.width);
    expect(stub!.height / full!.height).toBeCloseTo(420 / 1273, 2);
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
    expect(rasterize).toHaveBeenCalledWith([{ index: 0, svg: INKED_SHEET }]);
  });

  it("saves every page but rasterises only the ones with ink", async () => {
    const png = { mimeType: "image/png" as const, dataBase64: "ink", width: 1200, height: 3330 };
    const save = vi.fn().mockResolvedValue(undefined);
    const rasterize = vi.fn().mockResolvedValue(png);
    const pages = [INKED_SHEET, EMPTY_SHEET, SECOND_INKED_SHEET];
    await captureExamWorking({ serialize: async () => pages, save, rasterize });
    expect(save).toHaveBeenCalledWith(pages);
    expect(rasterize).toHaveBeenCalledWith([
      { index: 0, svg: INKED_SHEET },
      { index: 2, svg: SECOND_INKED_SHEET },
    ]);
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
