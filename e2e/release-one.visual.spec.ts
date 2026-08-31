import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function expectNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const width = await page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
  );
  expect(width).toBeLessThanOrEqual(viewportWidth + 1);
}

test("Release 1 landing stays clear at desktop and phone sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "One place to do the work, and remember what matters.",
    })
  ).toBeVisible();
  await expect(page.getByText("Work naturally", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, 1440);
  await page.screenshot({ path: "test-results/release-one-landing-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, 390);

  // On a phone the reason to sign in has to sit under the headline, not below
  // everything else on the page.
  const headline = await page
    .getByRole("heading", { level: 1 })
    .boundingBox();
  const signIn = await page
    .getByRole("button", { name: "Continue with Google" })
    .boundingBox();
  const preview = await page
    .getByLabel("A folder, a notebook page, and a card waiting for review")
    .boundingBox();
  expect(headline && signIn && preview).toBeTruthy();
  expect(signIn!.y).toBeGreaterThan(headline!.y);
  expect(signIn!.y).toBeLessThan(preview!.y);

  await page.screenshot({ path: "test-results/release-one-landing-phone.png", fullPage: true });
});

test("Release 1 navigation and study workspace stay usable across sizes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  const desktopNav = page
    .getByRole("navigation", { name: "Primary" })
    .filter({ has: page.getByRole("button", { name: "Hide sidebar" }) });
  await expect(desktopNav).toBeVisible();
  await expect(desktopNav.getByText("Learning loop", { exact: true }).last()).toBeVisible();
  await expect(desktopNav.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(page.getByText("Getting today ready.")).toBeHidden({ timeout: 45_000 });
  await expectNoHorizontalOverflow(page, 1440);
  await page.screenshot({ path: "test-results/release-one-today-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto("/dashboard/practice");
  await expect(page.getByRole("heading", { name: "Folders", level: 1 })).toBeVisible();
  await expect(
    page.getByLabel("Loading folders and notebooks")
  ).toBeHidden({ timeout: 45_000 });
  await expectNoHorizontalOverflow(page, 1024);
  await page.screenshot({ path: "test-results/release-one-practice-tablet.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("Getting today ready.")).toBeHidden({ timeout: 45_000 });
  const mobileNav = page.locator("nav").filter({ has: page.getByRole("button", { name: "More" }) });
  await expect(mobileNav).toBeVisible();
  await expect(mobileNav.getByText("Today", { exact: true })).toBeVisible();
  await expect(mobileNav.getByText("Learn", { exact: true })).toBeVisible();
  await expect(mobileNav.getByText("Practice", { exact: true })).toBeVisible();
  await expect(mobileNav.getByText("Tutor", { exact: true })).toBeVisible();
  await expect(mobileNav.getByText("Cards", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, 390);
  await page.screenshot({ path: "test-results/release-one-today-phone.png", fullPage: true });

  await mobileNav.getByRole("button", { name: "More" }).click();
  const more = page.getByRole("dialog");
  await expect(more).toBeVisible();
  for (const label of ["Topics", "Goals", "Stars", "Progress", "Account"]) {
    await expect(more.getByText(label, { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/release-one-more-phone.png", fullPage: true });
  expect(errors).toEqual([]);
});
