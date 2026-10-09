import fs from "node:fs";
import path from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { E2E_NOTEBOOK_ID, E2E_PAGE_IDS, E2E_PROJECT_ID } from "./fixtures";
import {
  letter,
  openToolSettings,
  penDown,
  penMoves,
  penStroke,
  penUp,
  resetPage,
  scribble,
  setPenThickness,
  signIn,
  userId,
  type PenPoint,
  type Point,
} from "./ink-helpers";

/*
 * Captures what the notebook editor really saves after real writing, as golden
 * fixtures for the importer that reads pages saved by js-draw (docs/notebook-ink.md).
 * Every earlier sample in the repository was written by hand.
 *
 * Opt-in, because it rewrites tests/fixtures/ink/js-draw:
 *   INK_CAPTURE=1 npx playwright test ink-fixtures
 *
 * Each scenario draws on a blank page, waits for the autosave, reads the saved
 * SVG straight from the Firestore emulator (the ink record, or the page record
 * when the ink never moved to its own record) and writes it to <scenario>.svg.
 * manifest.json describes what was drawn in each.
 */
test.skip(!process.env.INK_CAPTURE, "Opt-in: set INK_CAPTURE=1 to capture saved-ink fixtures.");

test.use({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
test.setTimeout(300_000);

const FIXTURE_DIR = path.resolve(process.cwd(), "tests", "fixtures", "ink", "js-draw");
const PAGE_ID = E2E_PAGE_IDS[0];
/** The autosave waits for this long without a change (NOTEBOOK_AUTOSAVE_IDLE_MS). */
const AUTOSAVE_IDLE_MS = 5_000;

/** A Safari-on-iPad user agent, which is what turns pen pressure on in the editor. */
const IPAD_USER_AGENT =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

type SavedInk = { svg: string | null; from: "ink record" | "page record" | "none" };

/** The ink as the app last saved it, read as the emulator holds it. */
async function readSavedInk(uid: string, pageId: string): Promise<SavedInk> {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  const environment = await initializeTestEnvironment({ projectId: E2E_PROJECT_ID, firestore: { host, port: Number(port) } });
  try {
    let saved: SavedInk = { svg: null, from: "none" };
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const ink = await getDoc(doc(db, "users", uid, "notebookPageInk", pageId));
      const inkSvg = (ink.data() as { inkData?: { svg?: string } | null } | undefined)?.inkData?.svg;
      if (typeof inkSvg === "string") {
        saved = { svg: inkSvg, from: "ink record" };
        return;
      }
      const record = await getDoc(doc(db, "users", uid, "notebookPages", pageId));
      const pageSvg = (record.data() as { inkData?: { svg?: string } | null } | undefined)?.inkData?.svg;
      if (typeof pageSvg === "string") saved = { svg: pageSvg, from: "page record" };
    });
    return saved;
  } finally {
    await environment.cleanup();
  }
}

/**
 * Waits for the autosave to land and returns what it saved. The save runs
 * AUTOSAVE_IDLE_MS after the last change, so wait that out, then take the first
 * pair of reads, a moment apart, that agree while the header says it is saved.
 * `present` says whether ink is expected; `differentFrom` rules out an earlier state.
 */
async function waitForSavedInk(
  page: Page,
  uid: string,
  expected: { present?: boolean; differentFrom?: string | null } = {}
): Promise<SavedInk> {
  await page.waitForTimeout(AUTOSAVE_IDLE_MS + 1_500);
  const saved = page.getByRole("status", { name: "All changes saved" }).first();
  const deadline = Date.now() + 60_000;
  let previous: SavedInk | null = null;
  while (Date.now() < deadline) {
    if (await saved.isVisible().catch(() => false)) {
      const current = await readSavedInk(uid, PAGE_ID);
      const wanted =
        (expected.present === undefined || (current.svg !== null) === expected.present) &&
        (expected.differentFrom === undefined || current.svg !== expected.differentFrom);
      if (wanted && previous && previous.svg === current.svg) return current;
      previous = wanted ? current : null;
    } else {
      previous = null;
    }
    await page.waitForTimeout(1_200);
  }
  throw new Error("The notebook never reported a saved page matching what was drawn.");
}

type ScenarioNotes = {
  description: string;
  /** Strokes drawn, by the tool that drew them. */
  strokes: Record<string, number>;
  colours: string[];
  /** The thickness slider setting, or "default" when the scenario left it alone. */
  thicknessPercent: Record<string, number | "default">;
  pressureVaried: boolean;
  [detail: string]: unknown;
};

type Manifest = Record<string, ScenarioNotes & { file: string | null; savedFrom: SavedInk["from"]; svgBytes: number; svgPathElements: number }>;

function recordScenario(name: string, notes: ScenarioNotes, saved: SavedInk) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = saved.svg === null ? null : `${name}.svg`;
  const svgPath = path.join(FIXTURE_DIR, `${name}.svg`);
  if (saved.svg === null) fs.rmSync(svgPath, { force: true });
  else fs.writeFileSync(svgPath, saved.svg, "utf8");

  const manifestPath = path.join(FIXTURE_DIR, "manifest.json");
  let manifest: Manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    // No earlier capture, or an unreadable one: start the manifest afresh.
  }
  manifest[name] = {
    ...notes,
    file,
    savedFrom: saved.from,
    svgBytes: saved.svg === null ? 0 : Buffer.byteLength(saved.svg, "utf8"),
    svgPathElements: saved.svg === null ? 0 : (saved.svg.match(/<path\b/g) ?? []).length,
  };
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

type Notebook = {
  page: Page;
  cdp: CDPSession;
  uid: string;
  /** A point on the sheet, as fractions of its width and height. */
  at(fx: number, fy: number): Promise<Point>;
  sheetWidth(): Promise<number>;
};

/** A blank first page, open in the editor and ready for ink. */
async function openNotebook(page: Page): Promise<Notebook> {
  await resetPage();
  await signIn(page);
  await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${PAGE_ID}`);
  await expect(page.getByTestId("notebook-editor")).toHaveAttribute("data-notebook-ink-ready", "true");
  const cdp = await page.context().newCDPSession(page);
  const surface = page.getByRole("img", { name: "Notebook drawing page" });
  const sheet = async () => (await surface.boundingBox())!;
  return {
    page,
    cdp,
    uid: await userId(),
    at: async (fx, fy) => {
      const box = await sheet();
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    },
    sheetWidth: async () => (await sheet()).width,
  };
}

/** A nearly straight run of points, with a little hand wobble. */
function line(from: Point, to: Point, samples = 50, wobble = 2): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 7) * wobble,
    };
  });
}

/** The same points, each carrying the pressure `force(t)` gives along the stroke. */
function withForce(points: Point[], force: (t: number) => number): PenPoint[] {
  return points.map((point, index) => ({ ...point, force: force(index / (points.length - 1)) }));
}

/** Presses a toolbar tool once. Waits first, so it cannot count as a double press. */
async function pickTool(page: Page, name: "Pen (P)" | "Highlighter (H)" | "Eraser (E)") {
  await page.waitForTimeout(450);
  await page.getByRole("button", { name }).click();
}

/** Opens a tool's settings, picks `button`, and closes the panel. */
async function chooseInSettings(page: Page, tool: "Pen (P)" | "Highlighter (H)" | "Eraser (E)", button: string) {
  await page.waitForTimeout(450);
  const target = page.getByRole("button", { name: button, exact: true });
  await openToolSettings(page, tool, target);
  await target.click();
  await page.keyboard.press("Escape");
}

async function finish(notebook: Notebook, name: string, notes: ScenarioNotes, expected?: Parameters<typeof waitForSavedInk>[2]) {
  const saved = await waitForSavedInk(notebook.page, notebook.uid, expected ?? { present: true });
  recordScenario(name, notes, saved);
  return saved;
}

test("pen-thin", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  await setPenThickness(page, 20);
  const width = await notebook.sheetWidth();
  await penStroke(cdp, scribble(await at(0.1, 0.15), width * 0.8, 18, 90));
  await penStroke(cdp, scribble(await at(0.1, 0.22), width * 0.55, 14, 70));
  await penStroke(cdp, letter(await at(0.2, 0.32), 48));
  const dot = await at(0.5, 0.5);
  await penDown(cdp, dot);
  await page.waitForTimeout(80);
  await penUp(cdp, dot);

  await finish(notebook, "pen-thin", {
    description: "Pen at 20% thickness: two handwriting rows, one letter loop, and a single dot (pen down and up at one point, no moves).",
    strokes: { pen: 3 },
    dots: 1,
    colours: ["black (default)"],
    thicknessPercent: { pen: 20 },
    pressureVaried: false,
  });
});

test("pen-thick", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  await setPenThickness(page, 85);
  const width = await notebook.sheetWidth();
  await penStroke(cdp, scribble(await at(0.1, 0.2), width * 0.75, 30, 90));
  await penStroke(cdp, line(await at(0.15, 0.4), await at(0.8, 0.45), 60, 4));

  await finish(notebook, "pen-thick", {
    description: "Pen at 85% thickness: one handwriting row and one long, nearly straight stroke.",
    strokes: { pen: 2 },
    colours: ["black (default)"],
    thicknessPercent: { pen: 85 },
    pressureVaried: false,
  });
});

test.describe("with pressure", () => {
  test.use({ userAgent: IPAD_USER_AGENT });

  test("pen-pressure", async ({ page }) => {
    const notebook = await openNotebook(page);
    const { cdp, at } = notebook;
    // Every pen move the page sees, so the manifest records the pressure that
    // really arrived rather than the pressure this spec meant to send.
    await page.evaluate(() => {
      const seen: number[] = [];
      (window as unknown as { __penPressures: number[] }).__penPressures = seen;
      window.addEventListener(
        "pointermove",
        (event) => {
          if (event.pointerType === "pen") seen.push(event.pressure);
        },
        true
      );
    });
    await setPenThickness(page, 50);
    const width = await notebook.sheetWidth();
    await penStroke(cdp, withForce(scribble(await at(0.1, 0.2), width * 0.8, 24, 100), (t) => 0.2 + 0.7 * t));
    await penStroke(cdp, withForce(scribble(await at(0.1, 0.35), width * 0.8, 24, 100), (t) => 0.2 + 0.7 * Math.sin(t * Math.PI)));

    const pressures = await page.evaluate(() => (window as unknown as { __penPressures: number[] }).__penPressures);
    const distinct = new Set(pressures.map((value) => value.toFixed(2)));
    const pressureVaried = distinct.size >= 5;
    await finish(notebook, "pen-pressure", {
      description:
        "Pen at 50% thickness with an iPad user agent (which turns pressure on): one handwriting row with pressure rising 0.2 to 0.9, one with pressure rising and falling.",
      strokes: { pen: 2 },
      colours: ["black (default)"],
      thicknessPercent: { pen: 50 },
      pressureVaried,
      userAgent: IPAD_USER_AGENT,
      pressureSent: "0.2 to 0.9, as a ramp up and as a rise and fall",
      pressureObserved: {
        pointerMoves: pressures.length,
        distinctValues: distinct.size,
        min: pressures.length ? Math.min(...pressures) : null,
        max: pressures.length ? Math.max(...pressures) : null,
      },
      pressureNote: pressureVaried
        ? "Pressure reached the page. Whether the editor applied it shows in the saved shapes, as outlines that widen and narrow."
        : "The page saw too little variation in pointer pressure, so this stroke may have saved at a constant width.",
    });
  });
});

test("pen-straight-line", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  await setPenThickness(page, 40);
  const stroke = line(await at(0.2, 0.3), await at(0.75, 0.36), 40, 2);
  await penDown(cdp, stroke[0]);
  await penMoves(cdp, stroke.slice(1));
  // Holding still is what straightens the line (about a second, NOTEBOOK_STRAIGHTEN_HOLD).
  // The pen is held for 1.5s, moving less than half a pixel so the page keeps seeing it.
  const end = stroke.at(-1)!;
  const holdMoves = Array.from({ length: 25 }, (_, index) => ({ x: end.x + (index % 2 ? 0.3 : -0.3), y: end.y }));
  await penMoves(cdp, holdMoves, 60);
  await page.waitForTimeout(100);
  await penUp(cdp, end);

  await finish(notebook, "pen-straight-line", {
    description:
      "Pen at 40% thickness: one nearly straight stroke, then the pen held still for 1.5s before lifting, with the default Straighten and level setting, so it should snap to a line.",
    strokes: { pen: 1 },
    colours: ["black (default)"],
    thicknessPercent: { pen: 40 },
    pressureVaried: false,
    holdMs: 1500,
    straightenAttempted: true,
    straightenNote: "Inspect the saved path: a snapped line has far fewer points than the 40 sent.",
  });
});

test("pen-colours", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  const width = await notebook.sheetWidth();
  await chooseInSettings(page, "Pen (P)", "red pen color");
  await penStroke(cdp, scribble(await at(0.1, 0.2), width * 0.7, 20, 90));
  await chooseInSettings(page, "Pen (P)", "green pen color");
  await penStroke(cdp, scribble(await at(0.1, 0.32), width * 0.7, 20, 90));

  await finish(notebook, "pen-colours", {
    description: "Pen at its default thickness: one handwriting row in red, then one in green, picked from the pen settings colour presets.",
    strokes: { pen: 2 },
    colours: ["red", "green"],
    thicknessPercent: { pen: "default" },
    pressureVaried: false,
  });
});

test("highlighter", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  // The pen is the tool a page opens with.
  await penStroke(cdp, line(await at(0.15, 0.3), await at(0.85, 0.3), 50, 2));
  await pickTool(page, "Highlighter (H)");
  await penStroke(cdp, line(await at(0.15, 0.42), await at(0.85, 0.42), 50, 2));
  // Down across the pen line drawn first.
  await penStroke(cdp, line(await at(0.5, 0.22), await at(0.5, 0.38), 30, 1));

  await finish(notebook, "highlighter", {
    description:
      "One black pen line, then the highlighter (default yellow and thickness): a long stroke below the line and a short upright stroke crossing the pen line.",
    strokes: { pen: 1, highlighter: 2 },
    colours: ["black (default pen)", "yellow (default highlighter)"],
    thicknessPercent: { pen: "default", highlighter: "default" },
    pressureVaried: false,
  });
});

test("precision-erased", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  await penStroke(cdp, line(await at(0.15, 0.4), await at(0.85, 0.4), 60, 2));
  const precision = page.getByRole("button", { name: "precision eraser mode", exact: true });
  await page.waitForTimeout(450);
  await openToolSettings(page, "Eraser (E)", precision);
  await precision.click();
  await page.getByRole("button", { name: "medium eraser", exact: true }).click();
  await page.keyboard.press("Escape");
  // Straight down through the middle of the stroke.
  await penStroke(cdp, line(await at(0.5, 0.35), await at(0.5, 0.45), 20, 0));

  await finish(notebook, "precision-erased", {
    description:
      "One long pen stroke (default thickness), then the eraser in precision mode at medium size, dragged straight down through its middle so the stroke splits in two.",
    strokes: { pen: 1, eraser: 1 },
    colours: ["black (default)"],
    thicknessPercent: { pen: "default" },
    pressureVaried: false,
    eraserMode: "precision",
    eraserSize: "medium",
  });
});

test("cleared", async ({ page }) => {
  const notebook = await openNotebook(page);
  const { cdp, at } = notebook;
  const width = await notebook.sheetWidth();
  await penStroke(cdp, scribble(await at(0.1, 0.25), width * 0.7, 20, 90));
  const drawn = await waitForSavedInk(page, notebook.uid, { present: true });

  const clear = page.getByRole("button", { name: "Clear ink from this page" });
  await page.waitForTimeout(450);
  await openToolSettings(page, "Eraser (E)", clear);
  await clear.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear ink", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();

  const saved = await finish(notebook, "cleared", {
    description:
      "One pen handwriting row, saved, then \"Clear ink from this page\" from the eraser settings and confirmed. This is the page as saved after the clear.",
    strokes: { pen: 1 },
    colours: ["black (default)"],
    thicknessPercent: { pen: "default" },
    pressureVaried: false,
    clearedAfterSave: true,
  }, { differentFrom: drawn.svg });
  // A page with no ink may save no record at all, in which case there is no SVG to keep.
  console.log(`cleared: saved ink ${saved.svg === null ? "absent" : `${saved.svg.length} characters`} (${saved.from})`);
});
