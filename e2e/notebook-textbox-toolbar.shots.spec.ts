import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

/*
 * One walkthrough of the notebook toolbar and text boxes, logging what is on
 * screen at each step and asserting once at the end.
 *
 * Mouse, a Pencil-like pen and a finger are all driven, because the three take
 * different paths through the text box handlers: an unselected box hands a
 * finger to the page, while a pen or a mouse picks it up.
 */
test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number; text: string };
type Snapshot = {
  step: string;
  boxes: Box[];
  editing: boolean;
  handles: number;
  moveHandle: boolean;
  active: (string | null)[];
  settings: (string | null)[];
};

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });
}

async function snapshot(page: Page, step: string, log: Snapshot[]) {
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>(".notebook-text-object")];
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Drawing tools"]');
    const toolButtons = [...(toolbar?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const editor = document.querySelector<HTMLTextAreaElement>("[data-notebook-text-editor]");
    return {
      boxes: boxes.map((box) => {
        const rect = box.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (editor && box.contains(editor) ? editor.value : box.textContent ?? "").slice(0, 80),
        };
      }),
      editing: Boolean(editor),
      handles: document.querySelectorAll("[data-text-resize-handle]").length,
      moveHandle: Boolean(document.querySelector("[data-text-block-move-handle]")),
      active: toolButtons
        .filter((button) => button.dataset.active === "true")
        .map((button) => button.getAttribute("aria-label")),
      settings: toolButtons
        .filter((button) => button.getAttribute("aria-expanded") === "true")
        .map((button) => button.getAttribute("aria-label")),
    };
  });
  const entry = { step, ...state };
  console.log(JSON.stringify(entry));
  log.push(entry);
  return entry;
}

async function penDrag(cdp: CDPSession, from: Point, to: Point, steps = 10) {
  const base = { pointerType: "pen" as const, force: 0.5 };
  await cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved", ...from });
  await cdp.send("Input.dispatchMouseEvent", {
    ...base,
    type: "mousePressed",
    ...from,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let index = 1; index <= steps; index += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      ...base,
      type: "mouseMoved",
      x: from.x + ((to.x - from.x) * index) / steps,
      y: from.y + ((to.y - from.y) * index) / steps,
      button: "left",
      buttons: 1,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    ...base,
    type: "mouseReleased",
    ...to,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function touchDrag(cdp: CDPSession, from: Point, to: Point, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let index = 1; index <= steps; index += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * index) / steps,
          y: from.y + ((to.y - from.y) * index) / steps,
          id: 1,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function mouseDrag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const centre = (box: { x: number; y: number; w: number; h: number }): Point => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});

async function centreOf(page: Page, name: string): Promise<Point | null> {
  const box = await page
    .getByRole("button", { name, exact: true })
    .first()
    .boundingBox({ timeout: 2_000 })
    .catch(() => null);
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

const by = (from: Point, dx: number, dy: number): Point => ({ x: from.x + dx, y: from.y + dy });

test("notebook toolbar puts tools down, and text boxes move and resize", async ({ page }) => {
  const log: Snapshot[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`);
  const editor = page.getByTestId("notebook-editor");
  await expect(editor).toHaveAttribute("data-notebook-ink-ready", "true", { timeout: 90_000 });
  const cdp = await page.context().newCDPSession(page);
  const surface = page.getByRole("img", { name: "Notebook drawing page" });
  const sheet = (await surface.boundingBox())!;
  const at = (fx: number, fy: number): Point => ({
    x: sheet.x + sheet.width * fx,
    y: sheet.y + sheet.height * fy,
  });

  const pen = page.getByRole("button", { name: "Pen (P)" });
  const text = page.getByRole("button", { name: "Text box (T)" });

  // --- Toolbar ---
  await snapshot(page, "toolbar: opened", log);
  await page.waitForTimeout(500);
  await pen.click();
  await snapshot(page, "toolbar: press the pen in hand", log);
  await page.waitForTimeout(500);
  await pen.click();
  await snapshot(page, "toolbar: press it again, slowly", log);
  await page.waitForTimeout(500);
  await pen.dblclick();
  await snapshot(page, "toolbar: double press", log);
  await page.waitForTimeout(500);
  await pen.click();
  await snapshot(page, "toolbar: pick the pen back up", log);
  await page.waitForTimeout(500);
  await text.dblclick();
  await snapshot(page, "toolbar: double press text", log);

  // --- A new box, typed in, by mouse ---
  await page.waitForTimeout(500);
  await text.click();
  await page.mouse.click(at(0.3, 0.3).x, at(0.3, 0.3).y);
  await snapshot(page, "mouse: created", log);
  await page.keyboard.type("hello there, a note that runs onto another line");
  let state = await snapshot(page, "mouse: typed", log);

  const grip = await centreOf(page, "Move text box");
  if (grip) await mouseDrag(page, grip, by(grip, 60, 40));
  state = await snapshot(page, "mouse: moved by the grip while typing", log);
  await page.keyboard.type(" more");
  await snapshot(page, "mouse: kept typing after the move", log);

  const right = await centreOf(page, "Resize text box from right edge");
  if (right) await mouseDrag(page, right, by(right, 70, 0));
  await snapshot(page, "mouse: widened while typing", log);

  await page.keyboard.press("Escape");
  state = await snapshot(page, "mouse: escape", log);
  await mouseDrag(page, centre(state.boxes[0]!), by(centre(state.boxes[0]!), -50, 60));
  state = await snapshot(page, "mouse: dragged by its body", log);

  const bottom = await centreOf(page, "Resize text box from bottom edge");
  if (bottom) await mouseDrag(page, bottom, by(bottom, 0, 80));
  await snapshot(page, "mouse: taller from the bottom", log);
  const bottomAgain = await centreOf(page, "Resize text box from bottom edge");
  if (bottomAgain) await mouseDrag(page, bottomAgain, by(bottomAgain, 0, -300));
  await snapshot(page, "mouse: shrunk from the bottom past the text", log);
  const top = await centreOf(page, "Resize text box from top edge");
  if (top) await mouseDrag(page, top, by(top, 0, 200));
  await snapshot(page, "mouse: shrunk from the top past the text", log);

  // --- The same box with a pen ---
  await page.mouse.click(at(0.85, 0.9).x, at(0.85, 0.9).y);
  state = await snapshot(page, "pen: tapped away", log);
  await penDrag(cdp, centre(state.boxes[0]!), by(centre(state.boxes[0]!), 40, 70));
  state = await snapshot(page, "pen: dragged by its body", log);
  const penGrip = await centreOf(page, "Move text box");
  if (penGrip) await penDrag(cdp, penGrip, by(penGrip, -40, -50));
  await snapshot(page, "pen: moved by the grip", log);
  const penRight = await centreOf(page, "Resize text box from right edge");
  if (penRight) await penDrag(cdp, penRight, by(penRight, -40, 0));
  await snapshot(page, "pen: narrowed", log);

  // --- And a finger ---
  await page.mouse.click(at(0.85, 0.9).x, at(0.85, 0.9).y);
  state = await snapshot(page, "touch: tapped away", log);
  await page.touchscreen.tap(centre(state.boxes[0]!).x, centre(state.boxes[0]!).y);
  state = await snapshot(page, "touch: tapped the box", log);
  await touchDrag(cdp, centre(state.boxes[0]!), by(centre(state.boxes[0]!), 30, -40));
  state = await snapshot(page, "touch: dragged by its body", log);
  const touchGrip = await centreOf(page, "Move text box");
  if (touchGrip) await touchDrag(cdp, touchGrip, by(touchGrip, -30, 50));
  await snapshot(page, "touch: moved by the grip", log);
  const touchRight = await centreOf(page, "Resize text box from right edge");
  if (touchRight) await touchDrag(cdp, touchRight, by(touchRight, 40, 0));
  await snapshot(page, "touch: widened", log);

  // --- An empty box ---
  await page.mouse.click(at(0.85, 0.9).x, at(0.85, 0.9).y);
  await text.click();
  await page.mouse.click(at(0.55, 0.72).x, at(0.55, 0.72).y);
  await snapshot(page, "empty: created", log);
  await page.keyboard.press("Escape");
  state = await snapshot(page, "empty: escape", log);
  const empty = state.boxes[1]!;
  await mouseDrag(page, centre(empty), by(centre(empty), -60, -40));
  await snapshot(page, "empty: dragged by its body", log);

  await page.screenshot({ path: "test-results/notebook-textbox-toolbar.png" });
  console.log(JSON.stringify({ errors }));

  // --- One assertion pass over what was seen ---
  const step = (name: string) => log.find((entry) => entry.step === name)!;
  const moved = (before: string, after: string, index = 0) => {
    const a = step(before).boxes[index]!;
    const b = step(after).boxes[index]!;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };

  expect(step("toolbar: press the pen in hand").settings).toEqual(["Pen (P)"]);
  expect(step("toolbar: double press").active).toEqual([]);
  expect(step("toolbar: double press").settings).toEqual([]);
  expect(step("toolbar: pick the pen back up").active).toEqual(["Pen (P)"]);
  expect(step("toolbar: double press text").active).toEqual([]);

  expect(step("mouse: created").editing).toBe(true);
  expect(step("mouse: typed").boxes[0]!.text).toContain("hello there");
  expect(moved("mouse: typed", "mouse: moved by the grip while typing")).toBeGreaterThan(40);
  expect(step("mouse: moved by the grip while typing").editing).toBe(true);
  expect(step("mouse: kept typing after the move").boxes[0]!.text).toMatch(/ more$/);
  expect(step("mouse: widened while typing").boxes[0]!.w).toBeGreaterThan(
    step("mouse: kept typing after the move").boxes[0]!.w + 30
  );
  expect(moved("mouse: escape", "mouse: dragged by its body")).toBeGreaterThan(40);
  expect(step("mouse: taller from the bottom").boxes[0]!.h).toBeGreaterThan(
    step("mouse: dragged by its body").boxes[0]!.h + 40
  );
  // Shrinking stops at the text, and from the top it does not slide the box.
  const shrunk = step("mouse: shrunk from the bottom past the text").boxes[0]!;
  expect(shrunk.h).toBeLessThan(step("mouse: taller from the bottom").boxes[0]!.h);
  expect(shrunk.h).toBeGreaterThan(30);
  const fromTop = step("mouse: shrunk from the top past the text").boxes[0]!;
  expect(Math.abs(fromTop.y - shrunk.y)).toBeLessThan(4);

  expect(moved("pen: tapped away", "pen: dragged by its body")).toBeGreaterThan(40);
  expect(moved("pen: dragged by its body", "pen: moved by the grip")).toBeGreaterThan(40);
  expect(step("pen: narrowed").boxes[0]!.w).toBeLessThan(step("pen: moved by the grip").boxes[0]!.w - 20);

  expect(moved("touch: tapped the box", "touch: dragged by its body")).toBeGreaterThan(30);
  expect(moved("touch: dragged by its body", "touch: moved by the grip")).toBeGreaterThan(30);
  expect(step("touch: widened").boxes[0]!.w).toBeGreaterThan(step("touch: moved by the grip").boxes[0]!.w + 20);

  expect(step("empty: created").editing).toBe(true);
  expect(moved("empty: escape", "empty: dragged by its body", 1)).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});
