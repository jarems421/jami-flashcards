import { expect, test, type Page } from "@playwright/test";
import {
  E2E_CARDS,
  E2E_DECK_NAME,
  E2E_GOAL,
  E2E_SOURCE,
  E2E_TOPIC,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

/**
 * The browse screens had no browser coverage at all, so a page that threw on
 * load, rendered its empty state over real data, or lost its filters would
 * have reached the deploy unnoticed. These are deliberately shallow: each one
 * signs in, opens a screen, and proves the seeded row is on it.
 */

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

/** Opens a dashboard screen and waits for its heading. */
async function openScreen(page: Page, path: string, heading: string) {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({
    timeout: 45_000,
  });
  return errors;
}

test("Sources lists saved sources and filters them", async ({ page }) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/library", "Sources");

  await expect(page.getByText(E2E_SOURCE.title).first()).toBeVisible({ timeout: 45_000 });

  // A search that cannot match must not leave the previous list on screen.
  const search = page.getByLabel("Search Sources");
  await search.fill("zzzz-no-such-source");
  await expect(page.getByText(E2E_SOURCE.title)).toHaveCount(0);

  await search.fill("");
  await expect(page.getByText(E2E_SOURCE.title).first()).toBeVisible();

  expect(errors).toEqual([]);
});

test("Cards lists seeded cards and searches their fronts", async ({ page }) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/cards", "Cards");

  const search = page.getByPlaceholder("Search card fronts");
  await search.fill(E2E_CARDS[0].front);
  await expect(page.getByText(E2E_CARDS[0].front).first()).toBeVisible({
    timeout: 45_000,
  });

  // The other seeded card must drop out, or the filter is not applied.
  await expect(page.getByText(E2E_CARDS[1].front)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Topics lists topics and filters them", async ({ page }) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/topics", "Topics");

  const search = page.getByLabel("Search Topics");
  await search.fill(E2E_TOPIC.name);
  await expect(page.getByText(E2E_TOPIC.name).first()).toBeVisible({
    timeout: 45_000,
  });

  await search.fill("zzzz-no-such-topic");
  await expect(page.getByText(E2E_TOPIC.name)).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Decks lists the seeded deck", async ({ page }) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/decks", "Decks");

  await expect(page.getByText(E2E_DECK_NAME).first()).toBeVisible({
    timeout: 45_000,
  });
  // The create field is the page's main action; losing it makes the screen
  // read-only without anything failing.
  await expect(page.getByPlaceholder("Deck name")).toBeVisible();

  expect(errors).toEqual([]);
});

test("Goals lists an active goal", async ({ page }) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/goals", "Goals");

  await expect(page.getByText(E2E_GOAL.name).first()).toBeVisible({
    timeout: 45_000,
  });

  expect(errors).toEqual([]);
});

test("Progress renders its charts rather than failing to load them", async ({
  page,
}) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/progress", "Progress");

  // The charts are loaded on demand, so a broken dynamic import would leave
  // the range control on screen with nothing under it.
  await expect(page.getByLabel("Statistics time range")).toBeVisible({
    timeout: 45_000,
  });
  await expect(
    page.locator('[role="img"][aria-label*="Accuracy chart"]')
  ).toBeVisible({ timeout: 45_000 });

  expect(errors).toEqual([]);
});

test("Stars opens the constellation view", async ({ page }) => {
  await signIn(page);
  const errors = await openScreen(page, "/dashboard/constellation", "Stars");

  // The canvas background is lazily loaded behind an error boundary, so the
  // check is that the screen itself survives rather than what it draws.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(errors).toEqual([]);
});

test("phone keeps the browse screens usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  for (const [path, heading] of [
    ["/dashboard/cards", "Cards"],
    ["/dashboard/decks", "Decks"],
    ["/dashboard/topics", "Topics"],
  ] as const) {
    await openScreen(page, path, heading);
    const main = page.locator("main").first();
    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    // Content wider than the viewport is the classic phone regression.
    expect(box!.width).toBeLessThanOrEqual(390);
  }
});
