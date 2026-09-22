import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

/**
 * The Study Hub, at the three widths students actually use it at.
 *
 * The thing worth checking in a browser is not that the components render --
 * unit tests cover what they say -- but that the page still answers its own
 * question at 390px. It is a two-column layout whose left column is deliberately
 * oversized, and the failure it invites is the mission being pushed below the
 * fold, or the rail forcing a sideways scroll.
 */

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
  );
  expect(scrollWidth, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(width + 1);
}

async function openStudyHub(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("Getting today ready.")).toBeHidden({ timeout: 45_000 });
}

test("the Study Hub leads with one mission at every width", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await openStudyHub(page);

  /*
   * The mission is the page's answer, so it is the first heading inside the
   * content and it sits above the alternatives rather than among them.
   */
  const mission = page.getByRole("heading", { level: 2 }).first();
  await expect(mission).toBeVisible();
  const doors = page.getByText("Or study your way", { exact: true });
  await expect(doors).toBeVisible();

  const missionBox = await mission.boundingBox();
  const doorsBox = await doors.boundingBox();
  expect(missionBox && doorsBox).toBeTruthy();
  expect(doorsBox!.y).toBeGreaterThan(missionBox!.y);
  // And it is reachable without scrolling on a laptop.
  expect(missionBox!.y).toBeLessThan(700);

  /*
   * The ways in do not depend on the student's own data being readable. This
   * account's profile does not load in the emulator, which is exactly the case
   * worth pinning: a failed read may cost the recommendation, never every way
   * to start studying.
   */
  await expect(page.getByRole("link", { name: /^Review/ })).toBeVisible();
  await expect(page.getByText("This week", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, 1440);
  await page.screenshot({ path: "test-results/study-hub-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 820, height: 1180 });
  await openStudyHub(page);
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, 820);
  await page.screenshot({ path: "test-results/study-hub-tablet.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await openStudyHub(page);
  const phoneMission = page.getByRole("heading", { level: 2 }).first();
  await expect(phoneMission).toBeVisible();
  /*
   * Still the anchor once the two columns stack.
   *
   * Measured against what follows it rather than against the top of the
   * viewport: whatever sits above the page -- a verification notice, an
   * offline banner -- is not the page's business, and an absolute threshold
   * would only be measuring which banners this account happens to have.
   */
  const phoneMissionBox = await phoneMission.boundingBox();
  const phoneWeekBox = await page.getByText("This week", { exact: true }).boundingBox();
  const phoneDoorsBox = await page
    .getByText("Or study your way", { exact: true })
    .boundingBox();
  expect(phoneMissionBox && phoneWeekBox && phoneDoorsBox).toBeTruthy();
  expect(phoneWeekBox!.y).toBeGreaterThan(phoneMissionBox!.y);
  expect(phoneDoorsBox!.y).toBeGreaterThan(phoneMissionBox!.y);
  await expectNoHorizontalOverflow(page, 390);
  await page.screenshot({ path: "test-results/study-hub-phone.png", fullPage: true });

  expect(errors).toEqual([]);
});

const HANDOFF_KEY = "jami:mission-handoff";

/** Put a handoff where the Study Hub reads one, as a finished session would. */
async function seedHandoff(
  page: Page,
  record: Record<string, unknown> | null
) {
  await page.evaluate(
    ([key, value]) => {
      if (value === null) window.sessionStorage.removeItem(key as string);
      else window.sessionStorage.setItem(key as string, value as string);
    },
    [HANDOFF_KEY, record === null ? null : JSON.stringify(record)] as const
  );
}

test("the Study Hub acknowledges finished work, once, and only when it happened", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await openStudyHub(page);

  /*
   * A session that was opened and produced nothing.
   *
   * The study page only reports a completion once answers exist, so this is
   * what an abandoned mission leaves behind -- and the Hub must say nothing
   * about it. Congratulating somebody for work they did not do is the one
   * thing this surface cannot afford to get wrong.
   */
  await seedHandoff(page, {
    actionId: "folder:f1|low_mastery|topic:spec:quad-complete",
    headline: "Make completing the square exam-ready",
    conceptLabel: "Completing the square",
    startedAt: Date.now(),
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("Nice. That's done.")).toHaveCount(0);
  await expect(page.getByText("Good — that counts.")).toHaveCount(0);

  // The same mission, finished.
  await seedHandoff(page, {
    actionId: "folder:f1|low_mastery|topic:spec:quad-complete",
    headline: "Make completing the square exam-ready",
    conceptLabel: "Completing the square",
    startedAt: Date.now() - 60_000,
    completedAt: Date.now(),
    answered: 5,
    targetItems: 5,
  });
  await page.reload();
  await expect(page.getByText("Nice. That's done.")).toBeVisible();
  await expect(page.getByText("Completing the square · 5 / 5")).toBeVisible();
  // What was done sits above what follows from it, in one card.
  await expect(page.getByText("Next up", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, 1440);
  await page.screenshot({ path: "test-results/study-hub-complete-desktop.png", fullPage: true });

  // Read once: it belongs to the return journey, not to every later visit.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("Nice. That's done.")).toHaveCount(0);

  // Part-finished work gets its own wording rather than the finished wording
  // with a smaller number in it, and still fits a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await seedHandoff(page, {
    actionId: "folder:f1|low_mastery|topic:spec:quad-complete",
    headline: "Make completing the square exam-ready",
    conceptLabel: "Completing the square",
    startedAt: Date.now() - 60_000,
    completedAt: Date.now(),
    answered: 2,
    targetItems: 5,
  });
  await page.reload();
  await expect(page.getByText("Good — that counts.")).toBeVisible();
  await expect(page.getByText("Completing the square · 2 / 5")).toBeVisible();
  await expectNoHorizontalOverflow(page, 390);
  await page.screenshot({ path: "test-results/study-hub-complete-phone.png", fullPage: true });

  expect(errors).toEqual([]);
});
