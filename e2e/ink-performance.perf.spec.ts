import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { E2E_NOTEBOOK_ID, E2E_PAGE_IDS } from "./fixtures";
import {
  letter,
  penDown,
  penMoves,
  penStroke,
  penUp,
  pinch,
  resetPage,
  scribble,
  setPenThickness,
  signIn,
  touchDrag,
  type Point,
} from "./ink-helpers";
import { reactCommitCounterScript, strokeWithGates, waitForQuietFirestore, watchFirestoreRequests } from "./ink-perf-probes";

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
 *
 * It measures whichever engine the build has: js-draw (the baseline), or Jami
 * Ink when the build was made with NEXT_PUBLIC_ENABLE_JAMI_INK=true, which is
 * also set for this process so the editor-level gates are asserted. Those
 * gates need the real app; the renderer alone is gated by e2e/ink-engine/.
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
const JAMI = process.env.NEXT_PUBLIC_ENABLE_JAMI_INK === "true";
const THROTTLE = Number(process.env.CPU_THROTTLE ?? 4);

/** Watches frames, long tasks, pen events and both ink canvases. Restarted per phase. */
async function startPhase(page: Page) {
  await page.evaluate(() => {
    type Ink = {
      frames: number[];
      longTasks: number[];
      downs: Array<{ at: number; handlerMs: number }>;
      ups: number[];
      liveResizes: number;
      liveMoves: number;
      dryResizes: number;
      dryClears: number;
    };
    const w = window as unknown as { __ink: Ink; __inkInstalled?: boolean; __downStart?: number };
    w.__ink = { frames: [], longTasks: [], downs: [], ups: [], liveResizes: 0, liveMoves: 0, dryResizes: 0, dryClears: 0 };
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
    window.addEventListener(
      "pointerup",
      (event) => {
        if (event.pointerType === "pen") w.__ink.ups.push(performance.now());
      },
      true
    );
    window.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "pen" && w.__downStart !== undefined) {
        w.__ink.downs.push({ at: w.__downStart, handlerMs: performance.now() - w.__downStart });
      }
    });
    // js-draw's two canvases. Jami Ink has neither, and its canvas counts come
    // from the stroke gates instead.
    const live = document.querySelector("[data-notebook-live-ink-canvas]");
    const dry = document.querySelector<HTMLCanvasElement>("[data-notebook-live-ink-editor] .dryInkCanvas");
    if (!live || !dry) return;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === "style") w.__ink.liveMoves += 1;
        else w.__ink.liveResizes += 1;
      }
    }).observe(live, { attributes: true, attributeFilter: ["width", "height", "style"] });
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
      frames: number[]; longTasks: number[]; downs: Array<{ at: number; handlerMs: number }>; ups: number[];
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
    // Where each long frame fell: in a stroke, or within a second after a lift.
    const where = ink.frames.slice(1).flatMap((time, index) => {
      const delta = time - ink.frames[index];
      if (delta <= 25) return [];
      const lastDown = Math.max(-1, ...ink.downs.map((down) => down.at).filter((at) => at <= time));
      const lastUp = Math.max(-1, ...ink.ups.filter((at) => at <= time));
      if (lastDown > lastUp) return [`${Math.round(delta)}ms at stroke +${Math.round(time - lastDown)}`];
      if (lastUp > 0) return [`${Math.round(delta)}ms at lift +${Math.round(time - lastUp)}`];
      return [`${Math.round(delta)}ms outside strokes`];
    });
    return {
      frames: deltas.length,
      longFrames: where.slice(0, 6),
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
      let different = 0;
      let maxDelta = 0;
      let minX = Infinity;
      let maxX = -1;
      let minY = Infinity;
      let maxY = -1;
      let darkened = 0;
      let lightened = 0;
      for (let index = 0; index < pa.length; index += 4) {
        const la = 0.3 * pa[index] + 0.59 * pa[index + 1] + 0.11 * pa[index + 2];
        const lb = 0.3 * pb[index] + 0.59 * pb[index + 1] + 0.11 * pb[index + 2];
        if (la < 150) inkBefore += 1;
        if (lb < 150) inkAfter += 1;
        if (pa[index] !== pb[index] || pa[index + 1] !== pb[index + 1] || pa[index + 2] !== pb[index + 2]) {
          different += 1;
          maxDelta = Math.max(maxDelta, Math.abs(pa[index] - pb[index]), Math.abs(pa[index + 1] - pb[index + 1]), Math.abs(pa[index + 2] - pb[index + 2]));
          const px = (index / 4) % canvas.width;
          const py = Math.floor(index / 4 / canvas.width);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
        if (Math.abs(la - lb) > 40) {
          changed += 1;
          if (lb < la) darkened += 1;
          else lightened += 1;
        }
      }
      return {
        inkBefore,
        inkAfter,
        changed,
        different,
        darkened,
        lightened,
        ...(different ? { maxDelta, box: [minX, minY, maxX, maxY], clip: [canvas.width, canvas.height] } : {}),
      };
    },
    [before.toString("base64"), after.toString("base64")] as const
  );
}

/**
 * Writes a stroke, holds the pen still at its end, and compares what is on
 * screen held and lifted. Jami Ink's gate is that no pixel changes, for the pen
 * and the highlighter alike: `different` counts any channel of any pixel (the
 * baseline's `changed` uses a luma threshold that would miss a highlighter's
 * pale ink).
 *
 * The pen is held 150 ms before the shot, as a student's rests at the end of a
 * stroke. A highlighter draws its traced outline, which is what is saved, once
 * it has stopped for HIGHLIGHTER_SETTLE_MS (50 ms, lib/ink-dom/stroke-session.ts),
 * so by the held shot the outline is what is on screen and the lift draws
 * nothing (docs/notebook-ink.md, "The highlighter at the lift").
 */
async function liftDiff(page: Page, cdp: CDPSession, label: string, points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const clip = {
    x: Math.max(0, Math.min(...xs) - 40),
    y: Math.max(0, Math.min(...ys) - 40),
    width: Math.max(...xs) - Math.min(...xs) + 80,
    height: Math.max(...ys) - Math.min(...ys) + 80,
  };
  const base = await page.screenshot({ clip, animations: "allow", caret: "initial" });
  await penDown(cdp, points[0]);
  await penMoves(cdp, points.slice(1));
  await page.waitForTimeout(150);
  const held = await page.screenshot({ clip, animations: "allow", caret: "initial" });
  await penUp(cdp, points.at(-1)!);
  await page.waitForTimeout(500);
  const lifted = await page.screenshot({ clip, animations: "allow", caret: "initial" });
  const result = await compareShots(page, held, lifted);
  // Pixels the stroke put on the page (so a lift that "changes nothing" is not an empty one).
  const drawn = (await compareShots(page, base, held)).different;
  console.log(`LIFT ${label}: ${JSON.stringify({ ...result, drawn })}`);
  if (JAMI) {
    expect.soft(drawn, `${label}: the stroke drew something`).toBeGreaterThan(0);
    expect.soft(result.different, `${label}: pixels that change when the pen lifts`).toBe(0);
  }
}

/** Picks a drawing tool with one press (a second press on the same tool opens its settings). */
async function pickTool(page: Page, tool: "Pen (P)" | "Highlighter (H)") {
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: tool }).click();
  await page.waitForTimeout(450);
}

/**
 * Jami Ink's editor-level gates for one stroke, with every probe on: no canvas
 * allocation, layout read, React commit or Firestore request between pen down
 * and the last move, ink drawn inside each pointer event, and a pen packet's
 * handler inside the per-packet budget.
 */
async function gateStroke(
  page: Page,
  cdp: CDPSession,
  firestore: { count: number; lastAt: number },
  label: string,
  points: Point[]
) {
  await waitForQuietFirestore(page, firestore);
  const gates = await strokeWithGates(page, cdp, points, firestore);
  console.log(`GATES ${label}: ${JSON.stringify(gates)}`);
  expect(gates.commitsBeforeStroke, "the React commit counter counts the page loading").toBeGreaterThan(0);
  expect.soft(gates.moves, `${label}: pen moves seen`).toBeGreaterThan(points.length / 2);
  expect.soft(gates.canvasAllocations, `${label}: canvas allocations`).toBe(0);
  expect.soft(gates.layoutReads, `${label}: layout reads`).toBe(0);
  expect.soft(gates.reactCommits, `${label}: React commits`).toBe(0);
  expect.soft(gates.firestoreRequests, `${label}: Firestore requests`).toBe(0);
  expect.soft(gates.drawnInEvent, `${label}: pen moves with ink drawn inside the event`).toBe(gates.moves);
  expect.soft(gates.moveHandlerP95Ms, `${label}: pen packet handler p95 (ms)`).toBeLessThanOrEqual(4);
}

{
  const variant = LABEL;
  test(`ink performance: ${variant}${GPU ? " (gpu)" : ""}`, async ({ page }) => {
    // Before any app code, so React's first commit is counted too.
    if (JAMI) await page.addInitScript(reactCommitCounterScript);
    const firestore = watchFirestoreRequests(page);
    await resetPage();
    await signIn(page);
    await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`);
    await expect(page.getByTestId("notebook-editor")).toHaveAttribute("data-notebook-ink-ready", "true");
    const engine = (await page.locator("[data-jami-ink-host]").count()) > 0 ? "jami" : "js-draw";
    console.log(`ENGINE ${engine}`);
    expect(engine, "the engine in this build matches NEXT_PUBLIC_ENABLE_JAMI_INK").toBe(JAMI ? "jami" : "js-draw");
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
    const fitLong = await endPhase(page, `${variant} fit, long stroke`);
    if (JAMI) expect.soft(fitLong.over25ms, "fit, long stroke: frames over 25 ms").toBe(0);
    if (JAMI) await gateStroke(page, cdp, firestore, `${variant} fit`, scribble(at(0.1, 0.9), sheet.width * 0.75, 20, 200));
    await liftDiff(page, cdp, `${variant} fit thickness 50`, scribble(at(0.2, 0.86), sheet.width * 0.4, 30, 110));
    if (JAMI) {
      await pickTool(page, "Highlighter (H)");
      await liftDiff(page, cdp, `${variant} fit highlighter`, scribble(at(0.2, 0.03), sheet.width * 0.4, 10, 110));
      await pickTool(page, "Pen (P)");
    }

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
    const zoomedLong = await endPhase(page, `${variant} zoomed, long stroke`);
    if (JAMI) {
      // Headless Chromium composites in software and copies every changed tile
      // whole each frame, so a zoomed stroke misses frames there; the owner
      // accepted that on 10 October 2026 (docs/notebook-ink.md, "Not yet met").
      // The gate is held on the GPU.
      if (GPU) expect.soft(zoomedLong.over25ms, "zoomed, long stroke: frames over 25 ms").toBe(0);
      await gateStroke(
        page,
        cdp,
        firestore,
        `${variant} zoomed`,
        scribble({ x: frame.x + frame.width * 0.1, y: frame.y + frame.height * 0.4 }, frame.width * 0.75, 20, 200)
      );
    }

    for (const thickness of [20, 85]) {
      await setPenThickness(page, thickness);
      await liftDiff(
        page,
        cdp,
        `${variant} zoomed thickness ${thickness}`,
        scribble({ x: frame.x + frame.width * 0.2, y: frame.y + frame.height * (thickness === 20 ? 0.68 : 0.82) }, frame.width * 0.45, 50, 120)
      );
    }

    if (JAMI) {
      await pickTool(page, "Highlighter (H)");
      await liftDiff(
        page,
        cdp,
        `${variant} zoomed highlighter`,
        scribble({ x: frame.x + frame.width * 0.2, y: frame.y + frame.height * 0.6 }, frame.width * 0.45, 10, 120)
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
