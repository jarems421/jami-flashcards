import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { buildNotebookPagePayload } from "@/lib/workspace/notebook-page-writes";
import {
  E2E_FOLDER_ID,
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_PROJECT_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

/*
 * How writing, panning, pinching and the lift feel on a notebook page: the
 * measurements the Jami Ink performance gates in docs/notebook-ink.md are
 * read from.
 *
 * Opt-in, because it is slow and its numbers mean nothing on a busy machine:
 *   INK_PERF=1 npx playwright test ink-performance
 * INK_MODE=gpu runs it headed on this machine's GPU rather than headless,
 * where canvases are drawn in software. CPU_THROTTLE sets the slowdown (4).
 * INK_LABEL names the engine being measured in the output.
 */
test.skip(!process.env.INK_PERF, "Opt-in: set INK_PERF=1 to measure ink performance.");

const GPU = process.env.INK_MODE === "gpu";
test.use({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 2,
  hasTouch: true,
  ...(GPU ? { headless: false, launchOptions: { args: ["--ignore-gpu-blocklist"] } } : {}),
});
test.setTimeout(600_000);

const LABEL = process.env.INK_LABEL ?? "current";
const THROTTLE = Number(process.env.CPU_THROTTLE ?? 4);

type Point = { x: number; y: number };

async function userId() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-browser-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD, returnSecureToken: true }),
  });
  return ((await response.json()) as { localId: string }).localId;
}

/** The first page blank again, so every run writes on the same page. */
async function resetPage() {
  const uid = await userId();
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  const environment = await initializeTestEnvironment({ projectId: E2E_PROJECT_ID, firestore: { host, port: Number(port) } });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(
      doc(db, "users", uid, "notebookPages", E2E_PAGE_IDS[0]),
      buildNotebookPagePayload({
        notebookId: E2E_NOTEBOOK_ID,
        folderId: E2E_FOLDER_ID,
        pageNumber: 1,
        pageType: "blank",
        pageColor: "white",
        pageStyle: "grid",
        status: "blank",
        now: 1_800_000_000_000,
      })
    );
    await deleteDoc(doc(db, "users", uid, "notebookPageInk", E2E_PAGE_IDS[0]));
  });
  await environment.cleanup();
}

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

const pen = { pointerType: "pen" as const, force: 0.5 };

async function penDown(cdp: CDPSession, point: Point) {
  await cdp.send("Input.dispatchMouseEvent", { ...pen, type: "mouseMoved", ...point });
  await cdp.send("Input.dispatchMouseEvent", { ...pen, type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
}
async function penMoves(cdp: CDPSession, points: Point[], gapMs = 8) {
  for (const point of points) {
    await cdp.send("Input.dispatchMouseEvent", { ...pen, type: "mouseMoved", ...point, button: "left", buttons: 1 });
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}
async function penUp(cdp: CDPSession, point: Point) {
  await cdp.send("Input.dispatchMouseEvent", { ...pen, type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
}
async function penStroke(cdp: CDPSession, points: Point[]) {
  await penDown(cdp, points[0]);
  await penMoves(cdp, points.slice(1));
  await penUp(cdp, points.at(-1)!);
}

/** A handwriting-like row of joined loops across `width` pixels. */
function scribble(origin: Point, width: number, height: number, samples = 160): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    return {
      x: origin.x + t * width + Math.sin(t * Math.PI * 12) * height * 0.25,
      y: origin.y + Math.cos(t * Math.PI * 12) * height * 0.5,
    };
  });
}

/** One small letter-sized loop. */
function letter(origin: Point, size: number, samples = 26): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    return {
      x: origin.x + t * size * 0.8 + Math.sin(t * Math.PI * 2) * size * 0.3,
      y: origin.y - Math.sin(t * Math.PI) * size * 0.6 + Math.cos(t * Math.PI * 3) * size * 0.15,
    };
  });
}

async function touchDrag(cdp: CDPSession, from: Point, to: Point, steps = 20) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 7 }] });
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 7 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function pinch(cdp: CDPSession, center: Point, from: number, to: number, steps = 24) {
  const points = (distance: number) => [
    { x: center.x - distance / 2, y: center.y, id: 1 },
    { x: center.x + distance / 2, y: center.y, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(from + ((to - from) * step) / steps) });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function setPenThickness(page: Page, percent: number) {
  const slider = page.getByRole("slider", { name: "Pen thickness" });
  // The first press picks the pen, the next opens its settings -- but two
  // presses within NOTEBOOK_TOOL_DOUBLE_PRESS_MS (400ms) put the pen down.
  for (let press = 0; press < 3 && !(await slider.isVisible().catch(() => false)); press += 1) {
    if (press > 0) await page.waitForTimeout(450);
    await page.getByRole("button", { name: "Pen (P)" }).click();
  }
  await expect(slider).toBeVisible({ timeout: 5_000 });
  await slider.evaluate((input: HTMLInputElement, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, percent);
  await page.keyboard.press("Escape");
}

/** Watches frames, long tasks, pen events and both ink canvases. Restarted per phase. */
async function startPhase(page: Page) {
  await page.evaluate(() => {
    type Ink = {
      frames: number[];
      longTasks: number[];
      downs: Array<{ at: number; handlerMs: number }>;
      liveResizes: number;
      liveMoves: number;
      dryResizes: number;
      dryClears: number;
    };
    const w = window as unknown as { __ink: Ink; __inkInstalled?: boolean; __downStart?: number };
    w.__ink = { frames: [], longTasks: [], downs: [], liveResizes: 0, liveMoves: 0, dryResizes: 0, dryClears: 0 };
    if (w.__inkInstalled) return;
    w.__inkInstalled = true;
    const tick = (time: number) => {
      w.__ink.frames.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__ink.longTasks.push(Math.round(entry.duration));
    }).observe({ type: "longtask" });
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "pen") w.__downStart = performance.now();
      },
      true
    );
    window.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "pen" && w.__downStart !== undefined) {
        w.__ink.downs.push({ at: w.__downStart, handlerMs: performance.now() - w.__downStart });
      }
    });
    const live = document.querySelector("[data-notebook-live-ink-canvas]")!;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === "style") w.__ink.liveMoves += 1;
        else w.__ink.liveResizes += 1;
      }
    }).observe(live, { attributes: true, attributeFilter: ["width", "height", "style"] });
    const dry = document.querySelector<HTMLCanvasElement>("[data-notebook-live-ink-editor] .dryInkCanvas")!;
    new MutationObserver(() => {
      w.__ink.dryResizes += 1;
    }).observe(dry, { attributes: true, attributeFilter: ["width", "height"] });
    const ctx = dry.getContext("2d")!;
    const clear = ctx.clearRect.bind(ctx);
    ctx.clearRect = (x: number, y: number, width: number, height: number) => {
      if (width * height >= 0.9 * dry.width * dry.height) w.__ink.dryClears += 1;
      return clear(x, y, width, height);
    };
  });
}

async function endPhase(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const ink = (window as unknown as { __ink: {
      frames: number[]; longTasks: number[]; downs: Array<{ at: number; handlerMs: number }>;
      liveResizes: number; liveMoves: number; dryResizes: number; dryClears: number;
    } }).__ink;
    const deltas = ink.frames.slice(1).map((time, index) => time - ink.frames[index]);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pick = (q: number) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1) : 0);
    // For each pen-down: the gap from it to the first frame after it, and that frame's own length.
    const starts = ink.downs.map((down) => {
      const index = ink.frames.findIndex((time) => time >= down.at);
      if (index < 1) return null;
      return { wait: ink.frames[index] - down.at, frame: ink.frames[index] - ink.frames[index - 1], handler: down.handlerMs };
    }).filter((start): start is { wait: number; frame: number; handler: number } => start !== null);
    const mean = (values: number[]) => (values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : 0);
    return {
      frames: deltas.length,
      p50: pick(0.5),
      p95: pick(0.95),
      max: deltas.length ? +Math.max(...deltas).toFixed(1) : 0,
      over25ms: deltas.filter((delta) => delta > 25).length,
      longTasks: ink.longTasks,
      penDowns: starts.length,
      downHandlerMs: mean(starts.map((start) => start.handler)),
      downFirstFrameMs: mean(starts.map((start) => start.frame)),
      liveResizes: ink.liveResizes,
      liveMoves: ink.liveMoves,
      dryResizes: ink.dryResizes,
      dryFullClears: ink.dryClears,
    };
  });
  console.log(`PHASE ${label}: ${JSON.stringify(result)}`);
  return result;
}

/** Pixels of two same-sized screenshots: ink in each, and how many changed. */
async function compareShots(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(
    async ([first, second]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const [a, b] = await Promise.all([load(`data:image/png;base64,${first}`), load(`data:image/png;base64,${second}`)]);
      const canvas = document.createElement("canvas");
      canvas.width = a.width;
      canvas.height = a.height;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(a, 0, 0);
      const pa = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(b, 0, 0);
      const pb = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let inkBefore = 0;
      let inkAfter = 0;
      let changed = 0;
      let darkened = 0;
      let lightened = 0;
      for (let index = 0; index < pa.length; index += 4) {
        const la = 0.3 * pa[index] + 0.59 * pa[index + 1] + 0.11 * pa[index + 2];
        const lb = 0.3 * pb[index] + 0.59 * pb[index + 1] + 0.11 * pb[index + 2];
        if (la < 150) inkBefore += 1;
        if (lb < 150) inkAfter += 1;
        if (Math.abs(la - lb) > 40) {
          changed += 1;
          if (lb < la) darkened += 1;
          else lightened += 1;
        }
      }
      return { inkBefore, inkAfter, changed, darkened, lightened };
    },
    [before.toString("base64"), after.toString("base64")] as const
  );
}

/** Writes a stroke, holds the pen still at its end, and compares what is on screen held and lifted. */
async function liftDiff(page: Page, cdp: CDPSession, label: string, points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const clip = {
    x: Math.max(0, Math.min(...xs) - 40),
    y: Math.max(0, Math.min(...ys) - 40),
    width: Math.max(...xs) - Math.min(...xs) + 80,
    height: Math.max(...ys) - Math.min(...ys) + 80,
  };
  await penDown(cdp, points[0]);
  await penMoves(cdp, points.slice(1));
  await page.waitForTimeout(150);
  const held = await page.screenshot({ clip, animations: "allow", caret: "initial" });
  await penUp(cdp, points.at(-1)!);
  await page.waitForTimeout(500);
  const lifted = await page.screenshot({ clip, animations: "allow", caret: "initial" });
  const result = await compareShots(page, held, lifted);
  console.log(`LIFT ${label}: ${JSON.stringify(result)}`);
}

{
  const variant = LABEL;
  test(`ink performance: ${variant}${GPU ? " (gpu)" : ""}`, async ({ page }) => {
    await resetPage();
    await signIn(page);
    await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`);
    await expect(page.getByTestId("notebook-editor")).toHaveAttribute("data-notebook-ink-ready", "true");
    const cdp = await page.context().newCDPSession(page);
    if (GPU) {
      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "none";
      });
      console.log(`GPU ${renderer}`);
    }

    const surface = page.getByRole("img", { name: "Notebook drawing page" });
    let sheet = (await surface.boundingBox())!;
    const at = (fx: number, fy: number) => ({ x: sheet.x + sheet.width * fx, y: sheet.y + sheet.height * fy });

    // A page of handwriting, so a repaint costs what it does on a real page.
    await setPenThickness(page, 40);
    sheet = (await surface.boundingBox())!;
    for (let row = 0; row < 14; row += 1) {
      await penStroke(cdp, scribble(at(0.08, 0.08 + row * 0.06), sheet.width * 0.8, 18, 90));
    }
    await page.waitForTimeout(800);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

    // Fit: a line of short strokes, then a long one.
    await setPenThickness(page, 50);
    sheet = (await surface.boundingBox())!;
    await startPhase(page);
    for (let index = 0; index < 12; index += 1) {
      await penStroke(cdp, letter(at(0.1 + index * 0.06, 0.93), 22));
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    await endPhase(page, `${variant} fit, 12 short strokes`);
    await startPhase(page);
    await penStroke(cdp, scribble(at(0.1, 0.97), sheet.width * 0.75, 30, 200));
    await page.waitForTimeout(400);
    await endPhase(page, `${variant} fit, long stroke`);
    await liftDiff(page, cdp, `${variant} fit thickness 50`, scribble(at(0.2, 0.86), sheet.width * 0.4, 30, 110));

    // Zoomed in.
    const frame = (await page.locator("[data-notebook-page-frame]").boundingBox())!;
    const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    await startPhase(page);
    await pinch(cdp, centre, 120, 120 * 3.5);
    await page.waitForTimeout(1500);
    await endPhase(page, `${variant} pinch in and settle`);

    await startPhase(page);
    for (let index = 0; index < 12; index += 1) {
      await penStroke(cdp, letter({ x: frame.x + frame.width * (0.12 + index * 0.06), y: frame.y + frame.height * 0.3 }, 60));
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    await endPhase(page, `${variant} zoomed, 12 short strokes`);
    await startPhase(page);
    await penStroke(cdp, scribble({ x: frame.x + frame.width * 0.1, y: frame.y + frame.height * 0.5 }, frame.width * 0.75, 60, 200));
    await page.waitForTimeout(400);
    await endPhase(page, `${variant} zoomed, long stroke`);

    for (const thickness of [20, 85]) {
      await setPenThickness(page, thickness);
      await liftDiff(
        page,
        cdp,
        `${variant} zoomed thickness ${thickness}`,
        scribble({ x: frame.x + frame.width * 0.2, y: frame.y + frame.height * (thickness === 20 ? 0.68 : 0.82) }, frame.width * 0.45, 50, 120)
      );
    }

    // Zoomed panning, one finger, round a square.
    await startPhase(page);
    const moves: Array<[number, number]> = [[-260, 0], [0, -200], [260, 0], [0, 200], [-260, -200], [260, 200]];
    for (const [dx, dy] of moves) {
      await touchDrag(cdp, centre, { x: centre.x + dx, y: centre.y + dy });
      await page.waitForTimeout(700);
    }
    await endPhase(page, `${variant} zoomed, 6 pans`);

    await startPhase(page);
    await pinch(cdp, centre, 420, 120);
    await page.waitForTimeout(1500);
    await endPhase(page, `${variant} pinch out and settle`);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });
}
