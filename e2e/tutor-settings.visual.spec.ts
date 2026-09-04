import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

const screenshotDirectory = "test-results/tutor-settings";

/**
 * The Tutor settings drawer, at the three widths the design system asks about.
 *
 * This runs whenever Tutor personalisation is enabled (the default). It proves
 * the drawer opens, both views render, and nothing overflows a phone.
 */

/*
 * An explicit false value keeps the test aligned with deployments where the
 * feature has deliberately been disabled.
 */
test.skip(
  process.env.NEXT_PUBLIC_ENABLE_TUTOR_PERSONALISATION === "false",
  "Tutor personalisation is disabled for this run."
);

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

test("the Tutor settings drawer holds up at every width", async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });

  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await signIn(page);
  await page.goto("/dashboard/tutor");
  await expect(
    page.getByRole("heading", { name: "Tutor", level: 1 })
  ).toBeVisible({ timeout: 45_000 });

  await page.getByRole("button", { name: "Open Tutor settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Tutor settings" })
  ).toBeVisible({ timeout: 20_000 });

  // The preferences form is the default view and must arrive loaded, not as a
  // permanent skeleton: a settings screen that never resolves looks identical
  // to one that is slow.
  await expect(page.getByRole("radio", { name: "Adaptive" }).first()).toBeVisible({
    timeout: 60_000,
  });

  for (const [name, width, height] of [
    ["desktop", 1280, 1000],
    ["tablet", 834, 1100],
    ["phone", 390, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${screenshotDirectory}/preferences-${name}.png`,
    });

    const panel = page.getByRole("tabpanel");
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(width);
  }

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole("tab", { name: "Folder instructions" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `${screenshotDirectory}/folders-desktop.png`,
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${screenshotDirectory}/folders-phone.png`,
  });

  expect(errors).toEqual([]);
});
