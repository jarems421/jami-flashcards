import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_IMAGE_ALT,
  E2E_IMAGE_PAGE_ID,
  E2E_NOTEBOOK_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

const screenshotDirectory = "test-results/notebook-resize-sides";

/**
 * A placed picture resizes from anywhere along a side, not only its corners,
 * and keeps its shape and its place across the other axis while it does.
 */

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

test("a placed picture resizes from anywhere along its sides", async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 1180, height: 820 });
  await signIn(page);
  await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_IMAGE_PAGE_ID}`);
  await expect(page.getByTestId("notebook-editor")).toHaveAttribute("data-notebook-ink-ready", "true", {
    timeout: 60_000,
  });

  const image = page.getByRole("button", { name: `Move ${E2E_IMAGE_ALT}` });
  // The pen is the default tool; Escape drops to select, where pictures are handled.
  await page.keyboard.press("Escape");
  await image.click();
  const sides = page.locator("[data-resize-side]");
  await expect(sides).toHaveCount(4);
  await expect(page.locator("[data-image-resize-handle]")).toHaveCount(4);
  await image.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshotDirectory}/1-selected.png` });

  const before = (await image.boundingBox())!;
  // Well away from the corners: a third of the way down the right side.
  const fromX = before.x + before.width + 2;
  const fromY = before.y + before.height / 3;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(fromX + before.width * 0.25, fromY, { steps: 8 });
  await page.mouse.up();

  const after = (await image.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 1.15);
  // Its left side stays put, and it grows about its middle vertically.
  expect(Math.abs(after.x - before.x)).toBeLessThan(3);
  expect(Math.abs(after.y + after.height / 2 - (before.y + before.height / 2))).toBeLessThan(3);
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 1);
  await page.screenshot({ path: `${screenshotDirectory}/2-widened-from-side.png` });

  // And back in from the bottom side, which shrinks it.
  const bottomX = after.x + after.width * 0.7;
  const bottomY = after.y + after.height + 2;
  await page.mouse.move(bottomX, bottomY);
  await page.mouse.down();
  await page.mouse.move(bottomX, bottomY - after.height * 0.3, { steps: 8 });
  await page.mouse.up();
  const shrunk = (await image.boundingBox())!;
  expect(shrunk.height).toBeLessThan(after.height * 0.85);
  expect(Math.abs(shrunk.y - after.y)).toBeLessThan(3);

  expect(pageErrors).toEqual([]);
});
