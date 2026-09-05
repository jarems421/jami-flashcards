import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

/**
 * Editing a card must not move the cards around it.
 *
 * The editor used to open inside the grid row, and because the grid sizes its
 * rows with `auto-rows-fr` every card on the page grew to match the form. This
 * walks the global Cards page, measures every card before and after Edit is
 * clicked -- unfiltered and again inside a search -- and leaves screenshots at
 * three widths. The assertions at the end are the ones that would mean the bug
 * is back: a grid that changed shape, no editor on screen, or a page that has
 * started scrolling sideways.
 */

const OUT = "test-results/shots";
const log = (...parts: unknown[]) => console.log("·", ...parts);

type GridShape = {
  cards: { top: number; height: number }[];
  gridHeight: number;
  dialog: { width: number; height: number } | null;
  dialogTitle: string | null;
  overflow: number;
};

test("card editor walkthrough", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  const shape = (): Promise<GridShape> =>
    page.evaluate(() => {
      // The grid drops its id once a filter is on, so fall back to the shape of
      // the thing itself: the row-sized grid that holds the card sections.
      const grid =
        document.querySelector("#recent-cards-grid") ??
        [...document.querySelectorAll<HTMLElement>("div.auto-rows-fr")].find(
          (node) => node.querySelector(":scope > section")
        ) ??
        null;
      const dialog = document.querySelector('[role="dialog"]');
      const dialogBox = dialog?.getBoundingClientRect();
      return {
        cards: [...(grid?.querySelectorAll(":scope > section") ?? [])].map(
          (node) => {
            const box = node.getBoundingClientRect();
            return {
              top: Math.round(box.top + window.scrollY),
              height: Math.round(box.height),
            };
          }
        ),
        gridHeight: Math.round(grid?.getBoundingClientRect().height ?? 0),
        dialog: dialogBox
          ? {
              width: Math.round(dialogBox.width),
              height: Math.round(dialogBox.height),
            }
          : null,
        dialogTitle:
          dialog?.querySelector("h2")?.textContent?.trim() ?? null,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });

  const openEditor = async () => {
    await page.getByLabel("Card actions").first().click();
    await page.getByRole("button", { name: "Edit card" }).first().click();
    await page.waitForTimeout(400);
  };

  const seen: Record<string, GridShape> = {};

  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 120_000 });
  log("signed in");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard/cards");
  await page.locator("#recent-cards-grid section").first().waitFor({
    state: "visible",
    timeout: 120_000,
  });
  await page.waitForTimeout(600);

  seen["desktop-grid"] = await shape();
  log("desktop grid:", JSON.stringify(seen["desktop-grid"]));
  await page.screenshot({ path: `${OUT}/card-editor-grid.png` });

  await openEditor();
  seen["desktop-editing"] = await shape();
  log("desktop editing:", JSON.stringify(seen["desktop-editing"]));
  await page.screenshot({ path: `${OUT}/card-editor-desktop.png` });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  seen["desktop-closed"] = await shape();
  log("desktop closed:", JSON.stringify(seen["desktop-closed"]));

  // The surface the report came from: editing a result inside a search.
  await page.getByLabel("Search card fronts").fill("card");
  await page.waitForTimeout(900);
  seen["search-grid"] = await shape();
  log("search grid:", JSON.stringify(seen["search-grid"]));

  await openEditor();
  seen["search-editing"] = await shape();
  log("search editing:", JSON.stringify(seen["search-editing"]));
  await page.screenshot({ path: `${OUT}/card-editor-search.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByLabel("Search card fronts").fill("");
  await page.waitForTimeout(900);

  for (const { name, width, height } of [
    { name: "tablet", width: 834, height: 1112 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    seen[`${name}-grid`] = await shape();
    await openEditor();
    seen[`${name}-editing`] = await shape();
    log(`${name} editing:`, JSON.stringify(seen[`${name}-editing`]));
    await page.screenshot({ path: `${OUT}/card-editor-${name}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  for (const name of ["desktop", "search", "tablet", "phone"]) {
    const before = seen[`${name}-grid`];
    const during = seen[`${name}-editing`];
    expect(before.cards.length, `${name}: cards are listed`).toBeGreaterThan(1);
    expect(during.dialog, `${name}: the editor is on screen`).not.toBeNull();
    expect(during.dialogTitle, `${name}: it is the editor`).toBe("Edit card");
    // The point of the change: the grid underneath is untouched.
    expect(during.cards, `${name}: no card moved or grew`).toEqual(before.cards);
    expect(during.gridHeight, `${name}: the grid kept its height`).toBe(
      before.gridHeight
    );
    expect(during.overflow, `${name}: no sideways scroll`).toBeLessThanOrEqual(1);
  }

  expect(
    seen["desktop-closed"].dialog,
    "Escape closes the editor"
  ).toBeNull();
  expect(
    seen["desktop-closed"].cards,
    "the grid is unchanged after closing"
  ).toEqual(seen["desktop-grid"].cards);
});
