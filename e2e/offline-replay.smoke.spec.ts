import { expect, test, type Page } from "@playwright/test";
import {
  E2E_OFFLINE_CARDS,
  E2E_OFFLINE_DECK_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

const OFFLINE_STUDY_ROUTE = `/dashboard/study?mode=custom&decks=${E2E_OFFLINE_DECK_ID}`;
/** Matches `QUEUE_PREFIX` in lib/study/offline-study.ts. */
const QUEUE_PREFIX = "jami:offline-study:queue:";

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

/** Reviews the browser is holding locally, straight out of the queue. */
async function queuedReviews(page: Page) {
  return page.evaluate((prefix) => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) return parsed as { cardId: string }[];
    }
    return [] as { cardId: string }[];
  }, QUEUE_PREFIX);
}

/**
 * A review graded while the browser is offline must survive until the network
 * returns. Losing one loses study history the student cannot reconstruct, and
 * no unit test covers the path from grading through to the queue draining.
 */
test("a review graded offline syncs once the browser reconnects", async ({
  page,
  context,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await signIn(page);
  await page.goto(OFFLINE_STUDY_ROUTE);

  const card = flashcard(page);
  await expect(card).toBeVisible({ timeout: 45_000 });
  const cardId = await card.getAttribute("data-study-current-card-id");
  expect(E2E_OFFLINE_CARDS.map((entry) => entry.id)).toContain(cardId);
  expect(await queuedReviews(page)).toHaveLength(0);

  // Drop the network only once the session is loaded, so what is under test is
  // the queued review rather than a failed page load.
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await card.click();
  await expect(card).toHaveAttribute("aria-label", "Flashcard answer shown");
  await ratingButton(page, "Good").click();

  // The grade is held locally, against the card that was actually shown.
  await expect
    .poll(() => queuedReviews(page).then((reviews) => reviews.length), {
      timeout: 20_000,
    })
    .toBe(1);
  expect((await queuedReviews(page))[0]?.cardId).toBe(cardId);

  // And the page says so rather than failing quietly.
  await expect(
    page.getByText(/will sync when the browser is online/i)
  ).toBeVisible({ timeout: 20_000 });

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Reconnecting drains the queue rather than leaving the review stranded.
  // The success toast is deliberately not asserted: the session-complete screen
  // does not render it, so it would pin presentation rather than the outcome.
  await expect
    .poll(() => queuedReviews(page).then((reviews) => reviews.length), {
      timeout: 45_000,
    })
    .toBe(0);

  // Surviving a reload is what separates "written to Firestore" from "only
  // cleared out of local storage".
  await page.reload();
  await expect(
    flashcard(page).or(page.getByText("Session complete"))
  ).toBeVisible({ timeout: 45_000 });
  expect(await queuedReviews(page)).toHaveLength(0);

  expect(pageErrors).toEqual([]);
});
