import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

/**
 * The Tutor settings drawer, at the three widths the design system asks about.
 *
 * Temporary: this runs only while `NEXT_PUBLIC_ENABLE_TUTOR_PERSONALISATION` is
 * on, and the flag ships off, so it is not yet a suite member. It exists to
 * prove the drawer opens, both views render, and nothing overflows a phone.
 */

/*
 * Held out of CI until it has been seen to pass, which it has not been.
 *
 * The flag is on by default now, so the feature is there to test -- the reason
 * this is opt-in is the spec itself. It was written on a machine that could not
 * run a build, emulators and a browser at the same time, and it has never
 * completed a run: the furthest it reached was the drawer opening. Adding an
 * unproven spec to a suite the whole `e2e` directory belongs to would break
 * every CI run for a fault in the test rather than the app.
 *
 * Run it with NEXT_PUBLIC_ENABLE_TUTOR_PERSONALISATION=true set for the runner.
 * Once it passes, delete this guard -- it earns its place then.
 */
test.skip(
  process.env.NEXT_PUBLIC_ENABLE_TUTOR_PERSONALISATION !== "true",
  "Opt-in until this spec has been seen to pass."
);

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

test("the Tutor settings drawer holds up at every width", async ({ page }) => {
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
      path: `e2e-screens/tutor-settings-preferences-${name}.png`,
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
    path: "e2e-screens/tutor-settings-folders-desktop.png",
  });

  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "e2e-screens/tutor-settings-folders-phone.png",
  });

  expect(errors).toEqual([]);
});
