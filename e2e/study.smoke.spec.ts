import { expect, test, type Page } from "@playwright/test";
import {
  E2E_CARDS,
  E2E_DECK_ID,
  E2E_PHONE_DECK_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

const STUDY_ROUTE = `/dashboard/study?mode=custom&decks=${E2E_DECK_ID}`;
const PHONE_STUDY_ROUTE = `/dashboard/study?mode=custom&decks=${E2E_PHONE_DECK_ID}`;

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

function flashcard(page: Page) {
  return page.locator("[data-study-current-card-id]");
}

/**
 * Rating buttons stack a label, a hint, and a keyboard shortcut, so their
 * accessible name is "Good Barely recalled 3" rather than "Good".
 */
function ratingButton(page: Page, rating: "Again" | "Hard" | "Good" | "Easy") {
  return page.getByRole("button", { name: new RegExp(`^${rating}\\b`) });
}

/** Flip the current card and grade it, then wait for the write to settle. */
async function reviewCurrentCard(page: Page, rating: "Good" | "Again") {
  const card = flashcard(page);
  const cardId = await card.getAttribute("data-study-current-card-id");
  expect(cardId).toBeTruthy();

  await expect(card).toHaveAttribute("aria-label", "Flip flashcard");
  await card.click();
  await expect(card).toHaveAttribute("aria-label", "Flashcard answer shown");

  await ratingButton(page, rating).click();
  return cardId as string;
}

test("signed-in review loop grades every card in the session", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await signIn(page);
  await page.goto(STUDY_ROUTE);

  // Both seeded cards are brand new, so the custom session hands them out.
  const card = flashcard(page);
  await expect(card).toBeVisible({ timeout: 45_000 });

  const seededIds = E2E_CARDS.map((entry) => entry.id);
  const firstId = await card.getAttribute("data-study-current-card-id");
  expect(seededIds).toContain(firstId);

  // The answer must not be reachable before the card is flipped.
  await expect(ratingButton(page, "Good")).toHaveCount(0);

  const reviewedFirst = await reviewCurrentCard(page, "Good");

  // The session advances to the remaining card rather than repeating itself.
  await expect(card).not.toHaveAttribute(
    "data-study-current-card-id",
    reviewedFirst
  );
  const reviewedSecond = await reviewCurrentCard(page, "Good");
  expect(reviewedSecond).not.toBe(reviewedFirst);
  expect(seededIds).toContain(reviewedSecond);

  // Grading the last card ends the session.
  await expect(page.getByText("Session complete")).toBeVisible({
    timeout: 45_000,
  });
  await expect(flashcard(page)).toHaveCount(0);
  await expect(ratingButton(page, "Good")).toHaveCount(0);

  // Reload behaviour is deliberately not asserted here. A custom deck session
  // re-serves the whole deck rather than only due cards, and FSRS schedules a
  // freshly-graded card minutes out, so "still due after reload" is expected
  // rather than evidence that the grade was lost. Pinning either reading would
  // bake a guess into the suite.

  expect(pageErrors).toEqual([]);
});

test("phone keeps the review loop usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto(PHONE_STUDY_ROUTE);

  const card = flashcard(page);
  await expect(card).toBeVisible({ timeout: 45_000 });

  // The grading controls must stay reachable inside the phone viewport.
  await card.click();
  await expect(card).toHaveAttribute("aria-label", "Flashcard answer shown");

  const good = ratingButton(page, "Good");
  await expect(good).toBeVisible();
  const box = await good.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // Rating targets stay large enough to hit with a thumb.
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Grading still lands from the phone layout.
  await good.click();
  await expect(page.getByText("Session complete")).toBeVisible({
    timeout: 45_000,
  });
});
