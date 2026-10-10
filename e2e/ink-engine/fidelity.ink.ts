import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openHarness } from "./bundle";
import { capture, diffPixels, saveDiff, type PixelDiff } from "./pixels";
import type { LiftOptions, Mode, Source } from "./harness/fidelity";

/*
 * Does Jami Ink draw a saved page as js-draw does, and does a stroke keep its
 * pixels when the pen lifts? (docs/notebook-ink.md, stage 3.)
 *
 * Fidelity: each page is drawn by js-draw, set up as the notebook sets it up,
 * and by the engine (importer, InkDocument, renderer), and the screenshots are
 * compared. Pages: the captured js-draw fixtures, old v1 strokes, and two
 * dense pages of about 3,000 segments, each fitted and zoomed in.
 *
 * Lift: a stroke is written as live ink, screenshotted with the pen down, lifted
 * and screenshotted again. The two must not differ in a single pixel.
 */

/**
 * Why the fidelity check has a tolerance at all, and why it is this one.
 *
 * Both renderers hand Skia the same path, but not on the same canvas. Chrome
 * antialiases a path differently on canvases of different sizes: the same line
 * at the same device position, drawn by js-draw's calls and by the engine's,
 * gives identical pixels on one canvas, but moves its edge by 0.02 to 0.11 of a
 * device pixel between a 2360 x 1640 canvas (js-draw's), a 1024 x 1024 one and
 * an 800 x 1600 one. The engine draws 512-pixel tiles. Along a near-horizontal
 * edge that shift runs a few pixels long and can reach half a pixel's coverage.
 * js-draw also flattens curves shorter than about 0.7 CSS pixels into lines,
 * which moves the round end of a thin stroke by a fraction of a pixel.
 *
 * So a pixel counts as different when a channel moves by more than
 * FIDELITY_TOLERANCE (a quarter of full contrast), and a page fails when the
 * pixels over it form a connected group larger than FIDELITY_MAX_CLUSTER.
 * Measured on every page here: antialiasing leaves isolated pixels and runs of
 * at most 11; every real difference found (a highlighter over a pen line
 * where Jami Ink draws it under, v1 highlighter opacity) makes groups of 75 to
 * over 200,000.
 */
const FIDELITY_TOLERANCE = 64;
const FIDELITY_MAX_CLUSTER = 16;

const FIXTURE_DIR = path.resolve(process.cwd(), "tests", "fixtures", "ink", "js-draw");
const fixtureSvg = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, `${name}.svg`), "utf8");
const FIXTURES = fs
  .readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".svg"))
  .map((file) => file.slice(0, -4))
  .sort();

type FidelityCase = {
  name: string;
  source: (page: Page) => Promise<Source>;
  /**
   * Why this page is expected to differ from js-draw, when it is. Such pages
   * are measured and reported but not held to the tolerance.
   */
  differsByDesign?: string;
};

const svgCase = (name: string): FidelityCase => ({
  name,
  source: async () => ({ kind: "svg", svg: fixtureSvg(name) }),
  ...(name === "highlighter"
    ? {
        differsByDesign:
          "the highlighter is drawn over the pen line in this page; js-draw keeps drawing order, Jami Ink always puts highlighter under pen ink (owner decision)",
      }
    : {}),
});

const CASES: FidelityCase[] = [
  ...FIXTURES.map(svgCase),
  // The same page with the highlighter written first, so both put it under the pen.
  { name: "highlighter (layered)", source: async () => ({ kind: "svg-layered", svg: fixtureSvg("highlighter") }) },
  {
    name: "legacy v1 pen",
    source: (page) => page.evaluate(() => ({ kind: "legacy" as const, strokes: window.inkHarness.legacyStrokes(false) })),
  },
  {
    name: "legacy v1 highlighter",
    source: (page) => page.evaluate(() => ({ kind: "legacy" as const, strokes: window.inkHarness.legacyStrokes(true) })),
    differsByDesign:
      "v1 highlighters carry their translucency in opacity=\"0.42\", which js-draw ignores (drawing them solid) and the importer honours (svg-style.ts)",
  },
  { name: "seeded 3,060 segments", source: async () => ({ kind: "seeded" }) },
  // Half its rows in the seed script's old implicit form, which js-draw drops.
  { name: "seeded, old implicit form", source: async () => ({ kind: "seeded", oldForm: true }) },
  { name: "handwriting 3,000 segments", source: async () => ({ kind: "handwriting", segments: 3_000 }) },
];

const MODES: Mode[] = ["fitted", "zoomed"];
const fidelityRows: string[] = [];
const liftRows: string[] = [];

const describe = (diff: PixelDiff, tolerance = FIDELITY_TOLERANCE) =>
  `max ${diff.maxDifference}, ${diff.overTolerance} over ${tolerance} (largest group ${diff.largestCluster}), ${diff.changed} differ at all, of ${diff.inked} inked`;

test.describe("Jami Ink fidelity against js-draw", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  for (const testCase of CASES) {
    for (const mode of MODES) {
      test(`${testCase.name}, ${mode}`, async ({ page }) => {
        const source = await testCase.source(page);
        const view = await page.evaluate(([s, m]) => window.inkHarness.showJsDraw(s, m), [source, mode] as const);
        const jsDraw = await capture(page, view);
        await page.evaluate(([s, m]) => window.inkHarness.showEngine(s, m), [source, mode] as const);
        const engine = await capture(page, view);
        const diff = diffPixels(jsDraw, engine, FIDELITY_TOLERANCE);
        fidelityRows.push(
          `| ${testCase.name} | ${mode} | ${diff.maxDifference} | ${diff.overTolerance} | ${diff.largestCluster} | ${diff.changed} | ${diff.inked} |${testCase.differsByDesign ? " by design" : ""}`
        );
        if (diff.largestCluster > FIDELITY_MAX_CLUSTER) await saveDiff(`fidelity ${testCase.name} ${mode}`, jsDraw, engine);
        test.info().annotations.push({ type: "fidelity", description: describe(diff) });
        if (testCase.differsByDesign) {
          // A control: the check must see a difference that is really there.
          test.info().annotations.push({ type: "differs by design", description: testCase.differsByDesign });
          expect(diff.largestCluster, `the known difference should be found (${describe(diff)})`).toBeGreaterThan(
            FIDELITY_MAX_CLUSTER
          );
          return;
        }
        if (testCase.name !== "cleared") expect(diff.inked, "the page should have ink on screen").toBeGreaterThan(0);
        expect(diff.largestCluster, describe(diff)).toBeLessThanOrEqual(FIDELITY_MAX_CLUSTER);
      });
    }
  }

  test.afterAll(() => {
    console.log(
      [
        "",
        `| Page | Scale | Max diff | Over ${FIDELITY_TOLERANCE} | Largest group | Differ at all | Inked |`,
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...fidelityRows,
      ].join("\n")
    );
  });
});

/**
 * After the lift the page is drawn again from nothing, and compared with what
 * the lift left. Live ink repaints only the tiles a packet changed, and Skia
 * picks its antialiasing per path (analytic or supersampled, by how many
 * points the path has for its size), so a tile painted while a long stroke
 * was shorter can be antialiased by the other route: measured at most 15 of
 * 255, at isolated edge pixels of a highlighter's footprints. Anything wrong
 * in what live ink repaints (a missed region, a stale stroke) is far larger.
 */
const REDRAW_TOLERANCE = 24;

const LIFTS: Array<{ name: string; options: Omit<LiftOptions, "mode"> }> = [
  { name: "pen thin", options: { layer: "pen", width: 3, pressure: false, commit: "same" } },
  { name: "pen thick, pressure", options: { layer: "pen", width: 14, pressure: true, commit: "same" } },
  { name: "pen thick, rebuilt path", options: { layer: "pen", width: 14, pressure: true, commit: "copy" } },
  { name: "highlighter thin", options: { layer: "highlighter", width: 16, pressure: false, commit: "same" } },
  { name: "highlighter thick", options: { layer: "highlighter", width: 48, pressure: false, commit: "same" } },
  // Every highlighter case ends with the traced union drawn live (the owner's
  // decision); this one commits an equal copy of it, as a saved stroke would be.
  { name: "highlighter thick, traced union", options: { layer: "highlighter", width: 48, pressure: false, commit: "copy" } },
];

test.describe("Jami Ink lift", () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  for (const lift of LIFTS) {
    for (const mode of MODES) {
      test(`${lift.name}, ${mode}`, async ({ page }) => {
        const options: LiftOptions = { ...lift.options, mode };
        const view = await page.evaluate((o) => window.inkHarness.liftSetup(o), options);
        await page.evaluate(() => window.inkHarness.liftWrite());
        const down = await capture(page, view);
        const commitMs = await page.evaluate(() => window.inkHarness.liftCommit());
        const lifted = await capture(page, view);
        await page.evaluate(() => window.inkHarness.liftRedraw());
        const redrawn = await capture(page, view);
        const diff = diffPixels(down, lifted, 0);
        const redraw = diffPixels(lifted, redrawn, REDRAW_TOLERANCE);
        liftRows.push(
          `| ${lift.name} | ${mode} | ${diff.changed} | ${redraw.changed} (max ${redraw.maxDifference}) | ${diff.inked} | ${commitMs.toFixed(2)} |`
        );
        if (diff.changed > 0) await saveDiff(`lift ${lift.name} ${mode}`, down, lifted);
        if (redraw.overTolerance > 0) await saveDiff(`redraw ${lift.name} ${mode}`, lifted, redrawn);
        expect(diff.inked, "the stroke should be on screen").toBeGreaterThan(0);
        expect(diff.changed, `pixels changed at the lift (${describe(diff, 0)})`).toBe(0);
        expect(redraw.overTolerance, `pixels changed when redrawn from scratch (${describe(redraw, REDRAW_TOLERANCE)})`).toBe(0);
      });
    }
  }

  test.afterAll(() => {
    console.log(
      ["", "| Lift | Scale | Changed at the lift | Changed when redrawn | Inked | Commit ms (unthrottled) |", "| --- | --- | --- | --- | --- | --- |", ...liftRows].join("\n")
    );
  });
});
