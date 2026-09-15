import { expect, test, type Page } from "@playwright/test";
import {
  E2E_EVIDENCE_CARDS,
  E2E_EVIDENCE_DECK_ID,
  E2E_TOPIC,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";
import { readReviewEvents } from "./learning-evidence";

/**
 * The Learning Engine end to end: what a student does, what gets recorded
 * because of it, and where Jami then sends them.
 *
 * Unit tests cover every piece with mocks. These check the pieces meet under
 * the real security rules, the real review flow and the real Today page.
 */

/** Everything a review event may hold. Anything else -- card text above all -- is a leak. */
const REVIEW_EVENT_FIELDS = [
  "cardId",
  "correct",
  "createdAt",
  "deckId",
  "rating",
  "reviewedAt",
  "schemaVersion",
  "studyDayKey",
];

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

function ratingButton(page: Page, rating: "Again" | "Hard" | "Good" | "Easy") {
  return page.getByRole("button", { name: new RegExp(`^${rating}\\b`) });
}

test("grading a card records exactly one compact review event", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await signIn(page);
  await page.goto(`/dashboard/study?mode=custom&decks=${E2E_EVIDENCE_DECK_ID}`);

  const card = flashcard(page);
  await expect(card).toBeVisible({ timeout: 45_000 });
  const cardId = await card.getAttribute("data-study-current-card-id");
  expect(E2E_EVIDENCE_CARDS.map((entry) => entry.id)).toContain(cardId);

  await card.click();
  await expect(card).toHaveAttribute("aria-label", "Flashcard answer shown");
  await ratingButton(page, "Good").click();
  await expect(page.getByText("Session complete")).toBeVisible({ timeout: 45_000 });

  // Written after the answer saves, without holding the answer up, so it is polled for.
  await expect
    .poll(async () => (await readReviewEvents(cardId as string)).length, { timeout: 30_000 })
    .toBe(1);

  const [event] = await readReviewEvents(cardId as string);
  expect(REVIEW_EVENT_FIELDS).toEqual(expect.arrayContaining(Object.keys(event?.data ?? {})));
  expect(event?.data).toMatchObject({
    schemaVersion: 1,
    cardId,
    deckId: E2E_EVIDENCE_DECK_ID,
    correct: true,
  });
  expect(JSON.stringify(event?.data)).not.toContain("Evidence card");

  expect(pageErrors).toEqual([]);
});

test("Today recommends testing a topic the student has material on, and the link opens it", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await signIn(page);

  const recommendation = page.getByRole("link", {
    name: new RegExp(`Test yourself on ${E2E_TOPIC.name}`),
  });
  await expect(recommendation).toBeVisible({ timeout: 60_000 });
  await expect(recommendation).toHaveAttribute(
    "href",
    `/dashboard/study?mode=custom&topics=${E2E_TOPIC.id}`
  );

  await recommendation.click();
  await page.waitForURL(new RegExp(`/dashboard/study\\?mode=custom&topics=${E2E_TOPIC.id}`), {
    timeout: 45_000,
  });

  expect(pageErrors).toEqual([]);
});
