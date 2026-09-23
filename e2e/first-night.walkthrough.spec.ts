import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

/**
 * First night, walked the way a student meets it: the tour's last word takes
 * them to their first star, the light follows what it points at, lighting a
 * star says what it gave them and offers the next, Today keeps the next star
 * one press away, and the second night picks up once the first is over.
 *
 * Unit tests cover the state machine. This covers what they cannot: that the
 * guide finds its target on a real page and stays on it while the page moves.
 *
 * Screenshots land in test-results/first-night for a person to look at.
 */

const SHOTS = "test-results/first-night";

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard/);
}

/** Moves the saved first-night state on, the way finishing earlier steps would. */
async function patchState(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((values) => {
    const key = Object.keys(localStorage).find((name) => name.startsWith("jami:first-night:"));
    if (!key) throw new Error("No first-night state saved.");
    const current = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    // Newer than anything the server holds, so the reload keeps it.
    localStorage.setItem(key, JSON.stringify({ ...current, ...values, updatedAt: Date.now() + 10_000_000 }));
  }, patch);
}

async function reportAction(page: Page, missionId: string) {
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent("jami:tutorial-action", { detail: { missionId: id, context: {} } }));
  }, missionId);
}

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 950 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`first night on ${device}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await signIn(page);

    await page.goto("/dashboard?first-night=preview");
    await expect(page.getByText("Welcome to your sky")).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/${device}-01-welcome.png` });

    await patchState(page, { stage: "tour", tourStep: 1, examReady: true });
    await page.reload();
    await expect(page.locator('.fn-guide[data-state="shown"]')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/${device}-02-tour.png` });

    // The tour's last word goes straight to the first star.
    await page.getByRole("button", { name: "Let's go" }).click();
    await page.waitForURL(/\/dashboard\/practice/);
    const target = page.locator('[data-tutorial-target="exam-questions"]').first();
    await expect(target).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.fn-guide[data-state="shown"]')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/${device}-03-practice-guide.png` });

    // The light stays on its target while the page scrolls under it.
    const drift = await page.evaluate(async () => {
      const aim = document.querySelector('[data-tutorial-target="exam-questions"]');
      const light = document.querySelector(".fn-light");
      if (!aim || !light) return null;
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const gaps: number[] = [];
      for (let step = 0; step < 10; step += 1) {
        window.scrollBy(0, step % 2 ? -37 : 41);
        await frame();
        await frame();
        const a = aim.getBoundingClientRect();
        const l = light.getBoundingClientRect();
        gaps.push(Math.abs(l.top + l.height / 2 - (a.top + a.height / 2)));
      }
      return Math.max(...gaps);
    });
    expect(drift).not.toBeNull();
    expect(drift!).toBeLessThanOrEqual(2);

    // The note is readable where it is, not pushed off a phone's screen.
    const note = await page.locator(".fn-note").boundingBox();
    expect(note).not.toBeNull();
    expect(note!.x).toBeGreaterThanOrEqual(0);
    expect(note!.x + note!.width).toBeLessThanOrEqual(viewport.width + 1);

    // Lighting the star says what it gave, and offers the next one.
    await reportAction(page, "mark-exam-answer");
    const bloom = page.locator(".fn-bloom");
    await expect(bloom).toContainText("Star 1 of 6 lit");
    await page.screenshot({ path: `${SHOTS}/${device}-04-bloom.png` });
    await page.getByRole("button", { name: /^Next: / }).click();
    await page.waitForURL(/\/dashboard\/decks/);
    await expect(page.locator('.fn-guide[data-state="shown"]')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/${device}-05-decks-guide.png` });

    // Today keeps the next star one press away.
    await page.goto("/dashboard");
    await expect(page.locator(".fn-next")).toContainText("Make a flashcard", { timeout: 60_000 });
    await page.screenshot({ path: `${SHOTS}/${device}-06-today.png` });

    // Once the first night is over, the second is offered and lights from use.
    await patchState(page, { stage: "finished", rewardState: "awarded", bonus: [], bonusHidden: false });
    await page.reload();
    const second = page.getByLabel("Second night");
    await expect(second).toContainText("Three more stars", { timeout: 60_000 });
    await second.screenshot({ path: `${SHOTS}/${device}-07-second-night.png` });
    await reportAction(page, "view-progress");
    await expect(bloom).toContainText("Second night · 1 of 3");
    await page.screenshot({ path: `${SHOTS}/${device}-08-second-bloom.png` });

    expect(errors).toEqual([]);
  });
}
