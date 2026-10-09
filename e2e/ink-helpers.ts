import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { expect, type CDPSession, type Locator, type Page } from "@playwright/test";
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
 * What the ink specs share: signing in, a blank page to write on, and a pen
 * that writes through the same Chrome DevTools input path a stylus does.
 * Used by the performance measurements and the saved-ink fixture capture.
 */

export type Point = { x: number; y: number };

/** A point on a pen stroke, with the pressure it was written at (0..1). */
export type PenPoint = Point & { force?: number };

export async function userId() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-browser-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD, returnSecureToken: true }),
  });
  return ((await response.json()) as { localId: string }).localId;
}

/** A page blank again (the first by default), so every run writes on the same page. */
export async function resetPage(pageId: string = E2E_PAGE_IDS[0]) {
  const uid = await userId();
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
  const environment = await initializeTestEnvironment({ projectId: E2E_PROJECT_ID, firestore: { host, port: Number(port) } });
  const position = (E2E_PAGE_IDS as readonly string[]).indexOf(pageId);
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(
      doc(db, "users", uid, "notebookPages", pageId),
      buildNotebookPagePayload({
        notebookId: E2E_NOTEBOOK_ID,
        folderId: E2E_FOLDER_ID,
        pageNumber: position >= 0 ? position + 1 : 1,
        pageType: "blank",
        pageColor: "white",
        pageStyle: "grid",
        status: "blank",
        now: 1_800_000_000_000,
      })
    );
    await deleteDoc(doc(db, "users", uid, "notebookPageInk", pageId));
  });
  await environment.cleanup();
}

export async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

const pen = { pointerType: "pen" as const };
const DEFAULT_FORCE = 0.5;

function penEvent(point: PenPoint) {
  return { ...pen, force: point.force ?? DEFAULT_FORCE, x: point.x, y: point.y };
}

export async function penDown(cdp: CDPSession, point: PenPoint) {
  await cdp.send("Input.dispatchMouseEvent", { ...penEvent(point), type: "mouseMoved" });
  await cdp.send("Input.dispatchMouseEvent", { ...penEvent(point), type: "mousePressed", button: "left", buttons: 1, clickCount: 1 });
}
export async function penMoves(cdp: CDPSession, points: PenPoint[], gapMs = 8) {
  for (const point of points) {
    await cdp.send("Input.dispatchMouseEvent", { ...penEvent(point), type: "mouseMoved", button: "left", buttons: 1 });
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}
export async function penUp(cdp: CDPSession, point: PenPoint) {
  await cdp.send("Input.dispatchMouseEvent", { ...penEvent(point), type: "mouseReleased", button: "left", buttons: 0, clickCount: 1 });
}
export async function penStroke(cdp: CDPSession, points: PenPoint[]) {
  await penDown(cdp, points[0]);
  await penMoves(cdp, points.slice(1));
  await penUp(cdp, points.at(-1)!);
}

/** A handwriting-like row of joined loops across `width` pixels. */
export function scribble(origin: Point, width: number, height: number, samples = 160): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    return {
      x: origin.x + t * width + Math.sin(t * Math.PI * 12) * height * 0.25,
      y: origin.y + Math.cos(t * Math.PI * 12) * height * 0.5,
    };
  });
}

/** One small letter-sized loop. */
export function letter(origin: Point, size: number, samples = 26): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    return {
      x: origin.x + t * size * 0.8 + Math.sin(t * Math.PI * 2) * size * 0.3,
      y: origin.y - Math.sin(t * Math.PI) * size * 0.6 + Math.cos(t * Math.PI * 3) * size * 0.15,
    };
  });
}

export async function touchDrag(cdp: CDPSession, from: Point, to: Point, steps = 20) {
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

export async function pinch(cdp: CDPSession, center: Point, from: number, to: number, steps = 24) {
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

/**
 * Presses a drawing tool's toolbar button until `visible` shows, which is
 * normally the tool's settings. The first press picks the tool, the next opens
 * its settings -- but two presses within NOTEBOOK_TOOL_DOUBLE_PRESS_MS (400ms)
 * put the tool down, so each later press waits that out.
 */
export async function openToolSettings(page: Page, tool: "Pen (P)" | "Highlighter (H)" | "Eraser (E)", visible: Locator) {
  for (let press = 0; press < 3 && !(await visible.isVisible().catch(() => false)); press += 1) {
    if (press > 0) await page.waitForTimeout(450);
    await page.getByRole("button", { name: tool }).click();
  }
  await expect(visible).toBeVisible({ timeout: 5_000 });
}

export async function setPenThickness(page: Page, percent: number) {
  const slider = page.getByRole("slider", { name: "Pen thickness" });
  await openToolSettings(page, "Pen (P)", slider);
  await slider.evaluate((input: HTMLInputElement, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, percent);
  await page.keyboard.press("Escape");
}
