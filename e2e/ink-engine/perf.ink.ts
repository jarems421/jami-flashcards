import { expect, test, type Page } from "@playwright/test";
import { openHarness } from "./bundle";
import { INK_CANVAS_BUDGET_BYTES, INK_CANVAS_MAX_PIXELS } from "@/lib/ink/render-plan";

/*
 * The render gates of docs/notebook-ink.md, measured on Jami Ink's renderer
 * alone (no app, no pointer input), in Chromium with the CPU slowed 4x at
 * 1180 x 820 and 2x density.
 *
 * Opt-in, because it is slow and its numbers mean nothing on a busy machine:
 *   INK_PERF=1 npx playwright test -c playwright.ink.config.ts perf
 * INK_MODE=gpu runs it headed on this machine's GPU. CPU_THROTTLE sets the
 * slowdown (4).
 *
 * Gates that need the real editor (ink drawn inside the pointer event, the
 * pinch, React renders and Firestore work during a stroke) are stage 4's, in
 * e2e/ink-performance.perf.spec.ts.
 */
test.skip(!process.env.INK_PERF, "Opt-in: set INK_PERF=1 to measure the renderer's gates.");
test.setTimeout(600_000);

const THROTTLE = Number(process.env.CPU_THROTTLE ?? 4);
const MODE = process.env.INK_MODE === "gpu" ? "headed GPU" : "headless";

const rows: string[] = [];
const report = (gate: string, measured: string, target: string, pass: boolean) => {
  rows.push(`| ${gate} | ${measured} | ${target} | ${pass ? "pass" : "MISS"} |`);
};
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function throttle(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
}

test.describe(`Jami Ink render gates (${MODE}, CPU ${THROTTLE}x)`, () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
    await throttle(page);
  });

  const writes = [
    { name: "pen thin", options: { layer: "pen", width: 3, pressure: false } },
    { name: "pen thick", options: { layer: "pen", width: 14, pressure: true } },
    { name: "highlighter thick", options: { layer: "highlighter", width: 48, pressure: false } },
  ] as const;

  for (const write of writes) {
    for (const mode of ["fitted", "zoomed"] as const) {
      test(`writing: ${write.name}, ${mode}`, async ({ page }) => {
        const result = await page.evaluate((o) => window.inkHarness.measureWriting(o), { ...write.options, mode });
        const label = `${write.name}, ${mode}`;
        report(`Work per packet, ${label}`, `${result.strokes} strokes, p95 ${result.packetMsP95} ms, max ${result.packetMsMax} ms (live draw alone p95 ${result.drawMsP95} ms)`, "≤ 4 ms", result.packetMsP95 <= 4);
        report(`Writing frames, ${label}`, `${result.framesOver25} of ${result.frames} over 25 ms (longest ${result.longestFrameMs} ms${result.longFrames.length ? `; ${result.longFrames.slice(0, 4).join(", ")}` : ""})`, "0 over 25 ms", result.framesOver25 === 0);
        report(
          `During the stroke, ${label}`,
          `${result.allocationsDuringStroke} canvas allocations, ${result.tileRendersDuringStroke} tile renders, ${result.layoutReadsDuringStroke} layout reads`,
          "0, 0, 0",
          result.allocationsDuringStroke + result.tileRendersDuringStroke + result.layoutReadsDuringStroke === 0
        );
        report(`Lift time, ${label}`, `${result.commitMs} ms (the first, cold: ${result.firstCommitMs} ms)`, "≤ 2 ms", result.commitMs <= 2);
        report(`Memory, ${label}`, `${mb(result.peakCanvasBytes)}, largest canvas ${(result.largestCanvasPixels / 1e6).toFixed(2)} MP`, "≤ 96 MB, ≤ 4 MP", result.peakCanvasBytes <= INK_CANVAS_BUDGET_BYTES && result.largestCanvasPixels <= INK_CANVAS_MAX_PIXELS);
        expect.soft(result.allocationsDuringStroke).toBe(0);
        expect.soft(result.tileRendersDuringStroke).toBe(0);
        expect.soft(result.layoutReadsDuringStroke).toBe(0);
        expect.soft(result.packetMsP95).toBeLessThanOrEqual(4);
        expect.soft(result.framesOver25).toBe(0);
        expect.soft(result.commitMs).toBeLessThanOrEqual(2);
        expect.soft(result.peakCanvasBytes).toBeLessThanOrEqual(INK_CANVAS_BUDGET_BYTES);
        expect.soft(result.largestCanvasPixels).toBeLessThanOrEqual(INK_CANVAS_MAX_PIXELS);
      });
    }
  }

  for (const source of ["handwriting", "seeded"] as const) {
    test(`page open: ${source}`, async ({ page }) => {
      const result = await page.evaluate((s) => window.inkHarness.measurePageOpen(s, "fitted"), source);
      report(
        `Page open, ${source} (${result.segments} segments)`,
        `first ink ${result.firstInkMs} ms, all visible ${result.visibleReadyMs} ms (reading the SVG ${result.importMs} ms)`,
        "first ink ≤ 150 ms",
        result.firstInkMs <= 150
      );
      report(`Page open slices, ${source}`, `longest ${result.sliceMsMax} ms (longest single tile step ${result.tileRenderMsMax} ms)`, "≤ 4 ms", result.sliceMsMax <= 4);
      expect.soft(result.sliceMsMax).toBeLessThanOrEqual(4);
      expect.soft(result.segments).toBeGreaterThanOrEqual(3_000);
      expect.soft(result.firstInkMs).toBeLessThanOrEqual(150);
    });
  }

  test("zoomed pan", async ({ page }) => {
    const result = await page.evaluate(() => window.inkHarness.measureZoomedPan());
    report(
      "Zoomed pan",
      `${result.blankTilesAfterPan} blank of ${result.visibleTilesPerPan} visible tiles after ${result.pans} half-tile pans; slices ≤ ${result.sliceMsMax} ms, longest tile ${result.tileRenderMsMax} ms; ${result.framesOver25} frames over 25 ms`,
      "no blank tiles, ≤ 4 ms slices",
      result.blankTilesAfterPan === 0 && result.sliceMsMax <= 4
    );
    report("Memory, zoomed pan", `${mb(result.peakCanvasBytes)}, largest canvas ${(result.largestCanvasPixels / 1e6).toFixed(2)} MP`, "≤ 96 MB, ≤ 4 MP", result.peakCanvasBytes <= INK_CANVAS_BUDGET_BYTES && result.largestCanvasPixels <= INK_CANVAS_MAX_PIXELS);
    expect.soft(result.blankTilesAfterPan).toBe(0);
    expect.soft(result.sliceMsMax).toBeLessThanOrEqual(4);
    expect.soft(result.peakCanvasBytes).toBeLessThanOrEqual(INK_CANVAS_BUDGET_BYTES);
  });

  for (const mode of ["fitted", "zoomed"] as const) {
    test(`document changes, ${mode}`, async ({ page }) => {
      const results = await page.evaluate((m) => window.inkHarness.measureChanges(m), mode);
      for (const result of results) {
        report(
          `Change: ${result.name}, ${mode}`,
          `${result.ms} ms, ${result.tilesRedrawn} of ${result.tilesOnScreen} tiles on screen redrawn (${result.tileRenders} tile draws in all)`,
          "affected tiles only, ≤ 8 ms",
          result.ms <= 8 && result.tilesRedrawn < result.tilesOnScreen
        );
        expect.soft(result.ms).toBeLessThanOrEqual(8);
        expect.soft(result.tilesRedrawn).toBeLessThan(result.tilesOnScreen);
      }
    });
  }

  test("zoom settle", async ({ page }) => {
    const result = await page.evaluate(() => window.inkHarness.measureZoomSettle());
    report(
      "Zoom settle (fitted to zoomed)",
      `old level stood in with ${result.standInDrawn} of ${result.standInVisible} tiles drawn; new level replaced it after ${result.swapMs} ms`,
      "never blank",
      result.standInDrawn === result.standInVisible && result.levelSwaps === 1
    );
    expect.soft(result.standInDrawn).toBe(result.standInVisible);
    expect.soft(result.levelSwaps).toBe(1);
  });

  test.afterAll(() => {
    console.log(["", `Jami Ink render gates, ${MODE}, CPU ${THROTTLE}x`, "| Gate | Measured | Target | |", "| --- | --- | --- | --- |", ...rows].join("\n"));
  });
});
