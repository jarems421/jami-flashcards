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
  // The card scales in as it opens; measure it once it has arrived.
  // Only the card's own finite animations: some content inside it loops for ever.
  await card(page).evaluate((element) =>
    Promise.all(
      element
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished)
    )
  );
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

  // A small card folds the chat's actions into one menu, apart from the window controls.
  await page.getByRole("button", { name: "More Jami options" }).click();
  await expect(page.getByRole("menu", { name: "Jami options" })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/1b-more-menu.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  // Escape closed the menu, not Jami behind it.
  await expect(card(page)).toBeVisible();

  // Drag by the header's bare space, over the grab bar.
  await dragBy(page, opened.x + opened.width / 2, opened.y + 10, -500, -150);
  const moved = await box(page);
  console.log("card dragged to", moved);
  expect(moved.x).toBeLessThan(opened.x - 400);

  // Resize from the bottom-right corner, like an image.
  await dragBy(page, moved.x + moved.width - 2, moved.y + moved.height - 2, 120, 80);
  const resized = await box(page);
  console.log("card resized to", resized);
  expect(resized.width).toBeGreaterThan(moved.width + 100);
  await expect(page.getByRole("button", { name: "Open Jami chat history" })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/2-card-roomy.png` });

  // A corner dragged far inward stops at the smallest size, its opposite corner held.
  await dragBy(page, resized.x + 2, resized.y + 2, 900, 900);
  const smallest = await box(page);
  console.log("card at its smallest", smallest);
  expect(smallest.width).toBe(288);
  expect(smallest.height).toBe(320);
  expect(smallest.x + smallest.width).toBeCloseTo(resized.x + resized.width, 0);
  // Even at its smallest, the message box and send button fit.
  await expect(page.getByRole("button", { name: "Send message to Jami" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${screenshotDirectory}/2b-card-smallest.png` });
  await dragBy(page, smallest.x + 2, smallest.y + 2, 288 - resized.width, 320 - resized.height);
  const grownBack = await box(page);
  expect(grownBack.width).toBe(resized.width);

  // It cannot be dragged off the glass.
  await dragBy(page, grownBack.x + grownBack.width / 2, grownBack.y + 10, 3000, 3000);
  const pinnedToEdge = await box(page);
  expect(pinnedToEdge.x + pinnedToEdge.width).toBeLessThanOrEqual(1180 - 12);
  expect(pinnedToEdge.y + pinnedToEdge.height).toBeLessThanOrEqual(820 - 12);

  // A double click on the header makes it full size, like a window's title bar.
  await page.mouse.dblclick(pinnedToEdge.x + pinnedToEdge.width / 2, pinnedToEdge.y + 10);
  const full = await box(page);
  console.log("card maximised", full);
  expect(full.width).toBe(1180 - 24);
  await page.screenshot({ path: `${screenshotDirectory}/3-card-full-size.png` });

  // Dragging a full-size card brings it back to its own size, under the hand.
  await dragBy(page, full.x + full.width / 2, full.y + 10, -150, 120);
  const pulledOut = await box(page);
  console.log("card dragged out of full size", pulledOut);
  expect(pulledOut.width).toBe(pinnedToEdge.width);
  expect(pulledOut.height).toBe(pinnedToEdge.height);

  await page.getByRole("button", { name: "Make Jami full size" }).click();
  expect((await box(page)).width).toBe(1180 - 24);
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
