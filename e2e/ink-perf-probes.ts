import type { CDPSession, Page } from "@playwright/test";
import { penDown, penMoves, penUp, type PenPoint } from "./ink-helpers";

/*
 * What the editor-level ink gates watch for while a stroke is being written
 * (docs/notebook-ink.md, "Performance gates"): canvases allocated, layout
 * read, React commits, Firestore requests, and whether ink is drawn inside the
 * pointer event that carried the sample. Used by ink-performance.perf.spec.ts
 * for the Jami Ink engine.
 *
 * Only the React hook has to exist before the app loads; the rest is installed
 * into the running page just before the stroke it measures, so the timed
 * phases run without any of it.
 */

/** Installed with `page.addInitScript` before any app code: counts React commits. */
export function reactCommitCounterScript() {
  const w = window as unknown as { __reactCommits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
  w.__reactCommits = 0;
  if (w.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  const renderers = new Map<number, unknown>();
  let nextId = 1;
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers,
    inject(renderer: unknown) {
      const id = nextId;
      nextId += 1;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {
      w.__reactCommits += 1;
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
}

/** Wraps the browser's allocation, layout and canvas-drawing calls so a stroke can be audited. */
async function installStrokeProbes(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __strokeProbe?: unknown };
    if (w.__strokeProbe) return;
    const probe = {
      counting: false,
      canvases: 0,
      layoutReads: 0,
      inkDraws: 0,
      moves: 0,
      drawnInEvent: 0,
      handlerMs: [] as number[],
      /** Where layout reads came from (first stack lines), so a failing gate says who. */
      layoutCallers: {} as Record<string, number>,
    };
    w.__strokeProbe = probe;

    const wrapMethod = (target: object, name: string, before: (self: unknown) => void) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const original = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== "function") return;
      Object.defineProperty(target, name, {
        ...descriptor,
        value(this: unknown, ...args: unknown[]) {
          before(this);
          return original.apply(this, args);
        },
      });
    };
    const wrapAccessor = (target: object, name: string, kind: "get" | "set", before: () => void) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const original = descriptor?.[kind] as ((this: unknown, ...args: unknown[]) => unknown) | undefined;
      if (!original) return;
      Object.defineProperty(target, name, {
        ...descriptor,
        [kind]: function (this: unknown, ...args: unknown[]) {
          before();
          return original.apply(this, args);
        },
      });
    };
    const layout = () => {
      if (!probe.counting) return;
      probe.layoutReads += 1;
      const caller = (new Error().stack ?? "").split("\n").slice(3, 6).map((line) => line.trim().replace(/^at /, "")).join(" < ");
      probe.layoutCallers[caller] = (probe.layoutCallers[caller] ?? 0) + 1;
    };
    const canvas = () => {
      if (probe.counting) probe.canvases += 1;
    };

    // A canvas allocated, or one whose backing store is reset by a size write.
    const create = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (String(tag).toLowerCase() === "canvas") canvas();
      return create(tag, options);
    }) as typeof document.createElement;
    const NativeOffscreen = window.OffscreenCanvas;
    if (NativeOffscreen) {
      window.OffscreenCanvas = class extends NativeOffscreen {
        constructor(width: number, height: number) {
          super(width, height);
          canvas();
        }
      };
    }
    wrapAccessor(HTMLCanvasElement.prototype, "width", "set", canvas);
    wrapAccessor(HTMLCanvasElement.prototype, "height", "set", canvas);

    // Layout: every API that forces it.
    wrapMethod(Element.prototype, "getBoundingClientRect", layout);
    wrapMethod(Element.prototype, "getClientRects", layout);
    wrapMethod(window, "getComputedStyle", layout);
    for (const name of ["clientWidth", "clientHeight", "clientLeft", "clientTop", "scrollWidth", "scrollHeight", "scrollLeft", "scrollTop"]) {
      wrapAccessor(Element.prototype, name, "get", layout);
    }
    for (const name of ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop", "offsetParent", "innerText"]) {
      wrapAccessor(HTMLElement.prototype, name, "get", layout);
    }

    // Pixels put on a canvas inside the ink host.
    const inHost = new WeakMap<object, boolean>();
    const drawing = (self: unknown) => {
      if (!probe.counting) return;
      const element = (self as CanvasRenderingContext2D).canvas as HTMLCanvasElement | undefined;
      if (!element || typeof element.closest !== "function") return;
      // A tile canvas can be drawn before it is attached, so only "inside" is remembered.
      let inside = inHost.get(element) === true;
      if (!inside) {
        inside = element.closest("[data-jami-ink-host]") !== null;
        if (inside) inHost.set(element, true);
      }
      if (inside) probe.inkDraws += 1;
    };
    for (const name of ["fill", "stroke", "drawImage", "fillRect", "strokeRect", "putImageData", "clearRect"]) {
      wrapMethod(CanvasRenderingContext2D.prototype, name, drawing);
    }

    // Started and stopped over the raw DevTools connection: Playwright's own
    // actions take DOM snapshots for the trace, and those read layout.
    const w2 = window as unknown as { __reactCommits: number; __strokeProbeStart: () => void; __strokeProbeStop: () => unknown };
    let commits0 = 0;
    w2.__strokeProbeStart = () => {
      probe.canvases = 0;
      probe.layoutReads = 0;
      probe.inkDraws = 0;
      probe.moves = 0;
      probe.drawnInEvent = 0;
      probe.handlerMs = [];
      probe.layoutCallers = {};
      commits0 = w2.__reactCommits;
      probe.counting = true;
    };
    w2.__strokeProbeStop = () => {
      probe.counting = false;
      return {
        canvases: probe.canvases,
        layoutReads: probe.layoutReads,
        layoutCallers: Object.entries(probe.layoutCallers).sort((x, y) => y[1] - x[1]).slice(0, 6),
        reactCommits: w2.__reactCommits - commits0,
        moves: probe.moves,
        drawnInEvent: probe.drawnInEvent,
        handlerMs: probe.handlerMs,
      };
    };

    // The pointer event: window's capture phase runs before the app's handlers
    // and its bubble phase after them, so ink drawn between the two was drawn
    // inside that event, not in a later frame.
    let drawsBefore = 0;
    let startedAt = 0;
    window.addEventListener(
      "pointermove",
      (event) => {
        if (!probe.counting || event.pointerType !== "pen" || event.buttons === 0) return;
        drawsBefore = probe.inkDraws;
        startedAt = performance.now();
      },
      true
    );
    window.addEventListener("pointermove", (event) => {
      if (!probe.counting || event.pointerType !== "pen" || event.buttons === 0) return;
      probe.moves += 1;
      if (probe.inkDraws > drawsBefore) probe.drawnInEvent += 1;
      probe.handlerMs.push(performance.now() - startedAt);
    });
  });
}

/** Counts requests the page makes to the Firestore emulator. */
export function watchFirestoreRequests(page: Page) {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
  const seen = { count: 0, lastAt: 0 };
  page.on("request", (request) => {
    try {
      if (new URL(request.url()).host !== host) return;
    } catch {
      return;
    }
    seen.count += 1;
    seen.lastAt = Date.now();
  });
  return seen;
}

/** Waits for the page's autosave to land and the Firestore traffic to go quiet. */
export async function waitForQuietFirestore(page: Page, seen: { lastAt: number }) {
  // Autosave fires NOTEBOOK_AUTOSAVE_IDLE_MS (5 s) after the last edit.
  await page.waitForTimeout(6_500);
  for (let waited = 0; waited < 20_000 && Date.now() - seen.lastAt < 1_500; waited += 250) {
    await page.waitForTimeout(250);
  }
}

export type StrokeGates = {
  canvasAllocations: number;
  layoutReads: number;
  /** The most frequent sources of layout reads, when there were any. */
  layoutCallers: Array<[string, number]>;
  reactCommits: number;
  firestoreRequests: number;
  /** Pen move events delivered, and how many had ink drawn before their handlers finished. */
  moves: number;
  drawnInEvent: number;
  moveHandlerP95Ms: number;
  moveHandlerMaxMs: number;
  /** React commits so far, and how many the lift (after the stroke) caused: proves the counter counts. */
  commitsBeforeStroke: number;
  commitsAtLift: number;
};

const pickPercentile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)].toFixed(2);
};

/**
 * Writes one stroke with every probe on and reports what happened between the
 * pen touching down and its last move. The lift is left out on purpose: it
 * commits the stroke, tells the page and starts the autosave, all of which are
 * allowed.
 */
export async function strokeWithGates(
  page: Page,
  cdp: CDPSession,
  points: PenPoint[],
  firestore: { count: number }
): Promise<StrokeGates> {
  await installStrokeProbes(page);
  const commitsBeforeStroke = await page.evaluate(() => (window as unknown as { __reactCommits: number }).__reactCommits);
  await cdp.send("Runtime.evaluate", { expression: "window.__strokeProbeStart()" });
  const requestsBefore = firestore.count;
  await penDown(cdp, points[0]);
  await penMoves(cdp, points.slice(1));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const stopped = await cdp.send("Runtime.evaluate", {
    expression: "JSON.stringify(window.__strokeProbeStop())",
    returnByValue: true,
  });
  const during = JSON.parse(String(stopped.result.value)) as {
    canvases: number;
    layoutReads: number;
    layoutCallers: Array<[string, number]>;
    reactCommits: number;
    moves: number;
    drawnInEvent: number;
    handlerMs: number[];
  };
  const firestoreRequests = firestore.count - requestsBefore;
  await penUp(cdp, points.at(-1)!);
  await page.waitForTimeout(500);
  const commitsAfterLift = await page.evaluate(() => (window as unknown as { __reactCommits: number }).__reactCommits);
  return {
    canvasAllocations: during.canvases,
    layoutReads: during.layoutReads,
    layoutCallers: during.layoutCallers,
    reactCommits: during.reactCommits,
    firestoreRequests,
    moves: during.moves,
    drawnInEvent: during.drawnInEvent,
    moveHandlerP95Ms: pickPercentile(during.handlerMs, 0.95),
    moveHandlerMaxMs: pickPercentile(during.handlerMs, 1),
    commitsBeforeStroke,
    commitsAtLift: commitsAfterLift - (commitsBeforeStroke + during.reactCommits),
  };
}
