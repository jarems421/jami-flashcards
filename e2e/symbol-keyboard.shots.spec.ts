import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { E2E_DECK_ID, E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

/**
 * One look at the symbol palette, for eyes rather than CI.
 *
 * Nothing a unit test can assert tells you whether a palette is pleasant to
 * use, so this opens it on a real page at three widths, reports what is on
 * screen, and leaves screenshots behind. The assertions at the end are only the
 * things that would make it unusable: no palette, nothing in it, or a page that
 * has started scrolling sideways because of it.
 */

const OUT = "test-results/shots";
const log = (...parts: unknown[]) => console.log("·", ...parts);

test("symbol palette walkthrough", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  const describe = async () =>
    page.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]');
      return {
        trigger: document.querySelectorAll('[aria-label="Insert a symbol"]').length,
        open: Boolean(panel),
        groups: [
          ...document.querySelectorAll('[aria-label="Symbol groups"] [role="tab"]'),
        ].map((node) => node.textContent?.trim()),
        glyphs: panel ? panel.querySelectorAll("button").length : 0,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });

  const seen: Record<string, unknown> = {};

  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 120_000 });
  log("signed in");

  await page.goto(`/dashboard/decks/${E2E_DECK_ID}`);
  const trigger = page.getByLabel("Insert a symbol").first();
  await trigger.waitFor({ state: "visible", timeout: 120_000 });
  log("deck page:", JSON.stringify(await describe()));

  for (const { name, width, height } of [
    { name: "symbols-desktop", width: 1440, height: 900 },
    { name: "symbols-tablet", width: 834, height: 1112 },
    { name: "symbols-phone", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    await page.getByLabel("Insert a symbol").first().click();
    await page.waitForTimeout(400);
    const state = await describe();
    seen[name] = state;
    log(name, JSON.stringify(state));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });

    // Typing one in, then reading it back out of the field.
    await page.getByRole("button", { name: "Squared", exact: true }).first().click();
    await page.waitForTimeout(200);
    const typed = await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>(
        'input[placeholder="Front"]'
      );
      return field?.value ?? null;
    });
    seen[`${name}-typed`] = typed;
    log(`${name} typed:`, JSON.stringify(typed));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  for (const name of ["symbols-desktop", "symbols-tablet", "symbols-phone"]) {
    const state = seen[name] as {
      open: boolean;
      glyphs: number;
      groups: string[];
      overflow: number;
    };
    expect(state.open, `${name}: the palette opens`).toBe(true);
    expect(state.groups, `${name}: four groups`).toHaveLength(4);
    expect(state.glyphs, `${name}: glyphs render`).toBeGreaterThan(20);
    expect(state.overflow, `${name}: no sideways scroll`).toBeLessThanOrEqual(1);
    expect(seen[`${name}-typed`], `${name}: a symbol reaches the field`).toContain(
      "²"
    );
  }
});
