import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  E2E_MODES_DECK_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

/**
 * One pass through the study modes, in one browser, for eyes rather than CI.
 *
 * The assertion-per-step version cost half an hour a run on this machine
 * because every miss sat on its timeout. This walks the whole thing once,
 * reports what is actually on screen at each step, and asserts only at the end
 * -- so a single run tells you what happened instead of which selector missed.
 */

const EMAIL = E2E_USER_EMAIL;
const PASSWORD = E2E_USER_PASSWORD;
const DECK = E2E_MODES_DECK_ID;
const OUT = "test-results/shots";

const log = (...parts: unknown[]) => console.log("·", ...parts);

test("study modes walkthrough", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  const shoot = async (name: string) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    log("shot", name);
  };

  const describeStudyScreen = async () =>
    page.evaluate(() => ({
      // The mode control is a dropdown now, so the options only exist in the
      // DOM while it is open. What is always on screen is the trigger, showing
      // whichever mode this session would start in.
      picker: Boolean(document.querySelector("[data-study-mode-picker]")),
      pickers: document.querySelectorAll("[data-study-mode-picker]").length,
      mode:
        document
          .querySelector("[data-study-mode-picker] button")
          ?.textContent?.trim() ?? null,
      openOptions: document.querySelectorAll(
        "[data-study-mode-picker] [role=\"option\"]"
      ).length,
      preparing: Boolean(document.querySelector("[data-study-preparing]")),
      inSession: Boolean(document.querySelector("[data-study-current-card-id]")),
      answerField: Boolean(document.querySelector("#study-answer-entry")),
      mcqOptions: document.querySelectorAll(
        '[aria-label="Answer choices"] [role="radio"]'
      ).length,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      heading: document.querySelector("h2")?.textContent?.trim() ?? null,
    }));

  const seen: Record<string, unknown> = {};

    await page.goto("/auth");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });
    log("signed in");

    await page.goto(`/dashboard/study?decks=${DECK}`);
    // Wait for the surface rather than a fixed sleep: the first load reads
    // decks, cards, topics and the daily-review state, and on a loaded machine
    // that is well past any timeout worth hard-coding.
    await page
      .locator("[data-study-mode-picker]")
      .or(page.getByRole("button", { name: "End session" }))
      .first()
      .waitFor({ state: "visible", timeout: 90_000 });
    log("study screen:", JSON.stringify(await describeStudyScreen()));

    const endSession = page.getByRole("button", { name: "End session" });
    if (await endSession.count()) {
      await endSession.click();
      await page.waitForTimeout(3_000);
      log("ended a restored session");
      log("study screen:", JSON.stringify(await describeStudyScreen()));
    }

    for (const { name, width, height } of [
      { name: "home-desktop", width: 1440, height: 900 },
      { name: "home-tablet", width: 834, height: 1112 },
      { name: "home-phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(800);
      const state = await describeStudyScreen();
      seen[name] = state;
      log(name, JSON.stringify(state));
      await shoot(name);
    }

    await page.setViewportSize({ width: 1440, height: 900 });

    const builder = page.locator("#focused-review-builder");
    const start = builder.getByRole("button", { name: "Start Focused Review" });
    // The builder opens inside the Focused Review card, and its own copy of the
    // mode dropdown is the one this walk drives.
    const modeTrigger = builder
      .locator("[data-study-mode-picker] button")
      .first();

    for (const mode of ["Type Answer", "Gap Fill", "Multiple Choice"]) {
      if (!(await modeTrigger.count())) {
        log(`SKIP ${mode}: no mode dropdown on screen`);
        continue;
      }
      await modeTrigger.click();
      await page.waitForTimeout(300);
      const option = builder.getByRole("option", {
        name: new RegExp(`^${mode}`),
      });
      if (!(await option.count())) {
        log(`SKIP ${mode}: not offered by the dropdown`);
        await page.keyboard.press("Escape");
        continue;
      }
      await option.click();
      await page.waitForTimeout(600);
      await shoot(`picked-${mode.replace(/\s+/g, "-").toLowerCase()}`);

      if (!(await start.count())) {
        log(`SKIP ${mode}: no start button`);
        continue;
      }
      await start.click();
      await page.waitForTimeout(4_000);
      const modeState = await describeStudyScreen();
      seen[mode] = modeState;
      log(mode, JSON.stringify(modeState));
      await shoot(`session-${mode.replace(/\s+/g, "-").toLowerCase()}`);

      if (mode === "Type Answer" && (await page.locator("#study-answer-entry").count())) {
        await page.locator("#study-answer-entry").fill("not the answer at all");
        await page.getByRole("button", { name: "Check answer" }).click();
        await page.waitForTimeout(1_500);
        await shoot("type-answer-missed");
        log("after a miss:", JSON.stringify(await describeStudyScreen()));
      }

      const end = page.getByRole("button", { name: "End session" });
      if (await end.count()) {
        await end.click();
        await page.waitForTimeout(3_000);
      }
    }
  // Asserted once, at the end, on what the walk actually saw.
  expect(seen["home-desktop"], "the mode dropdown renders").toMatchObject({
    picker: true,
    mode: expect.stringContaining("Classic"),
  });
  for (const width of ["home-desktop", "home-tablet", "home-phone"]) {
    expect(
      (seen[width] as { overflow: number }).overflow,
      `${width} must not scroll sideways`
    ).toBeLessThanOrEqual(1);
  }
  expect(seen["Type Answer"], "Type Answer asks for an answer").toMatchObject({
    answerField: true,
  });
  expect(seen["Gap Fill"], "Gap Fill asks for an answer").toMatchObject({
    answerField: true,
  });
  expect(
    (seen["Multiple Choice"] as { mcqOptions: number }).mcqOptions,
    "Multiple Choice offers four options"
  ).toBe(4);
});
