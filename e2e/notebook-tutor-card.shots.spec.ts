import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

const screenshotDirectory = "test-results/notebook-tutor-card";

/**
 * The floating Tutor card over a notebook, walked through once at tablet size.
 *
 * Proves the card is non-modal, can be dragged, resized from a corner, made full
 * size and restored, shrunk to a pill, and reduced to one pinned answer; and that
 * a phone still gets the full-screen sheet.
 */

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

function card(page: Page) {
  return page.getByRole("dialog", { name: "Jami" });
}

async function box(page: Page) {
  const rect = await card(page).boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

async function dragBy(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("the Tutor floats over a notebook and goes where the student puts it", async ({
  page,
}) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/ai/assistant", async (route) => {
    const reply = "Close. Expand your brackets: swap the signs so it gives -5x.";
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "text", value: reply }),
        JSON.stringify({
          type: "done",
          reply,
          used: [{ kind: "current-context", label: "Current notebook page" }],
        }),
      ].join("\n"),
    });
  });

  await page.setViewportSize({ width: 1180, height: 820 });
  await signIn(page);
  await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`);
  await expect(page.getByTestId("notebook-editor")).toHaveAttribute(
    "data-notebook-ink-ready",
    "true",
    { timeout: 60_000 }
  );

  await page.getByRole("button", { name: "Ask Jami", exact: true }).click();
  await expect(card(page)).toBeVisible();
  expect(await card(page).getAttribute("aria-modal")).toBeNull();
  await expect(page.locator("[data-dialog-backdrop]")).toHaveCount(0);
  const opened = await box(page);
  console.log("card opened at", opened);
  expect(opened.width).toBe(360);
  expect(opened.x + opened.width).toBe(1180 - 12);
  await page.screenshot({ path: `${screenshotDirectory}/1-card-landscape.png` });

  // Drag by the header's bare space, left of the title.
  await dragBy(page, opened.x + opened.width / 2, opened.y + 6, -500, -150);
  const moved = await box(page);
  console.log("card dragged to", moved);
  expect(moved.x).toBeLessThan(opened.x - 400);

  // Resize from the bottom-right corner.
  await dragBy(page, moved.x + moved.width - 2, moved.y + moved.height - 2, 120, 80);
  const resized = await box(page);
  console.log("card resized to", resized);
  expect(resized.width).toBeGreaterThan(moved.width + 100);
  await page.screenshot({ path: `${screenshotDirectory}/2-card-moved-resized.png` });

  // It cannot be dragged off the glass.
  await dragBy(page, resized.x + resized.width / 2, resized.y + 6, 3000, 3000);
  const pinnedToEdge = await box(page);
  expect(pinnedToEdge.x + pinnedToEdge.width).toBeLessThanOrEqual(1180 - 12);
  expect(pinnedToEdge.y + pinnedToEdge.height).toBeLessThanOrEqual(820 - 12);

  await page.getByRole("button", { name: "Make Jami full size" }).click();
  const full = await box(page);
  console.log("card maximised", full);
  expect(full.width).toBe(1180 - 24);
  await page.screenshot({ path: `${screenshotDirectory}/3-card-full-size.png` });
  await page.getByRole("button", { name: "Restore Jami to its card" }).click();
  expect((await box(page)).width).toBe(pinnedToEdge.width);

  await page.getByPlaceholder("Ask Jami...").fill("Is my factorising right?");
  await page.getByRole("button", { name: "Send message to Jami" }).click();
  await expect(card(page).getByText("swap the signs")).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/4-card-answer.png` });

  await page.getByRole("button", { name: "Keep beside page" }).click();
  await expect(card(page)).toHaveCount(0);
  const pinned = page.getByRole("complementary", { name: "Pinned answer from Jami" });
  await expect(pinned).toContainText("swap the signs");
  const pinBox = (await pinned.boundingBox())!;
  await dragBy(page, pinBox.x + 60, pinBox.y + 8, -780, -300);
  const pinMoved = (await pinned.boundingBox())!;
  console.log("pinned note dragged to", pinMoved);
  expect(pinMoved.x).toBeLessThan(pinBox.x - 600);
  await page.screenshot({ path: `${screenshotDirectory}/5-pinned-answer.png` });

  await page.getByRole("button", { name: "Unpin this answer" }).click();
  await expect(pinned).toHaveCount(0);
  const pill = page.getByRole("button", { name: "Open Jami", exact: true });
  await expect(pill).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/6-pill.png` });
  await pill.click();
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText("swap the signs")).toBeVisible();
  expect((await box(page)).width).toBe(pinnedToEdge.width);

  // Portrait tablet: still a card, pulled back on screen.
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(300);
  const portrait = await box(page);
  console.log("card in portrait", portrait);
  expect(portrait.x + portrait.width).toBeLessThanOrEqual(820 - 12);
  await expect(page.locator("[data-dialog-backdrop]")).toHaveCount(0);
  await page.screenshot({ path: `${screenshotDirectory}/7-card-portrait.png` });

  // Phone: the full-screen sheet, as before.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await expect(page.locator("[data-dialog-backdrop]")).toHaveCount(1);
  await page.screenshot({ path: `${screenshotDirectory}/8-phone-sheet.png` });

  // The place is remembered on this device.
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.reload();
  await expect(page.getByTestId("notebook-editor")).toHaveAttribute(
    "data-notebook-ink-ready",
    "true",
    { timeout: 60_000 }
  );
  await page.getByRole("button", { name: "Ask Jami", exact: true }).click();
  const remembered = await box(page);
  console.log("card after reload", remembered);
  expect(remembered.width).toBe(pinnedToEdge.width);

  expect(pageErrors).toEqual([]);
});
