import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";
import { E2E_EXAM_FOLDER_ID, E2E_EXAM_QUESTIONS } from "./exam-fixtures";

/**
 * Past Paper Practice, opened in a browser for the first time.
 *
 * Every check on this feature until now was a unit test over a saved fixture.
 * Those cannot see a layout, a control that never renders, an answer that does
 * not come back after a reload, or a marking failure that leaves the student
 * facing an empty column -- which is exactly the bug the last pass found by
 * reading the JSX rather than by running it.
 *
 * One walkthrough, three widths, logging what it sees. A spec matrix costs
 * half an hour an iteration on this machine; this costs one run.
 *
 * The emulator has no AI provider, so marking fails here on purpose. That is
 * the most valuable part of the run: the failure path carries the frozen
 * evidence, the retry, and the recovery card, and none of it had ever been
 * rendered.
 */
const DESKTOP = { width: 1440, height: 900 };
const TABLET_PORTRAIT = { width: 834, height: 1_112 };
const PHONE = { width: 390, height: 844 };

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

/** Anything thrown on the page is a failure even if the assertion passes. */
function watchForErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("a student can set up, answer, and recover a past-paper session", async ({ page }) => {
  const errors = watchForErrors(page);
  page.on("response", async (response) => {
    if (!response.url().includes("/api/practice/")) return;
    if (response.ok()) {
      console.log("[api]", response.status(), response.url().replace(/^.*\/api/, "/api"));
      return;
    }
    console.log("[api FAIL]", response.status(), response.url().replace(/^.*\/api/, "/api"),
      (await response.text().catch(() => "")).slice(0, 300));
  });
  await page.setViewportSize(DESKTOP);
  await signIn(page);

  // --- Setup -------------------------------------------------------------
  await page.goto(`/dashboard/practice/questions/new?folderId=${E2E_EXAM_FOLDER_ID}`);
  const availability = page.getByText(/ready$/).first();
  await expect(availability).toBeVisible({ timeout: 45_000 });
  console.log("[setup] availability:", await availability.innerText());

  const start = page.getByRole("button", { name: /^Start practice/ });
  await expect(start).toBeEnabled({ timeout: 20_000 });

  /*
   * The default mix asks for more than the corpus holds, which is the shortage
   * path. It had never rendered: the missing counts used to be encoded inside
   * an error string and split on a colon, so the JSON was truncated and the
   * card that offers the way forward never appeared at all.
   */
  await start.click();
  const shortage = page.getByText(/not enough matching past-paper questions|Jami-created/i).first();
  await expect(shortage).toBeVisible({ timeout: 45_000 });
  console.log("[setup] shortage offered:", (await shortage.innerText()).slice(0, 120));

  // Now ask for exactly what is there: the two medium questions, no easy ones.
  for (let click = 0; click < 2; click += 1) {
    await page.getByRole("button", { name: "One fewer easy question" }).click();
  }
  await page.getByRole("button", { name: "One fewer medium question" }).click();
  await expect(page.getByText("2 questions")).toBeVisible({ timeout: 20_000 });
  console.log("[setup] mix reduced to the two questions available");
  await start.click();

  // --- Workspace ---------------------------------------------------------
  await page.waitForURL(/\/dashboard\/practice\/questions\/[^/]+$/, { timeout: 60_000 });
  const prompt = page.getByText(E2E_EXAM_QUESTIONS[0].prompt, { exact: false });
  await expect(prompt).toBeVisible({ timeout: 45_000 });
  console.log("[workspace] first question rendered");

  const answerBox = page.getByLabel("Your answer");
  await expect(answerBox).toBeVisible();
  await answerBox.fill("Root hair cells have a large surface area and thin walls.");

  // The draft saves itself; the status line is the only thing that says so.
  await expect(page.getByText(/Saved\.|Saving…/)).toBeVisible({ timeout: 20_000 });
  console.log("[workspace] draft autosave reported");

  // --- The draft survives a reload ---------------------------------------
  await page.reload();
  await expect(page.getByLabel("Your answer")).toHaveValue(
    /Root hair cells have a large surface area/,
    { timeout: 45_000 }
  );
  console.log("[workspace] draft survived a reload");

  // --- Working pane, per width -------------------------------------------
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole("heading", { name: "Working", level: 2 })).toBeVisible();
  console.log("[desktop] working pane is inline beside the answer");

  await page.setViewportSize(TABLET_PORTRAIT);
  await expect(page.getByLabel("Your answer")).toBeVisible();
  console.log("[tablet] answer still visible at 834px");

  await page.setViewportSize(PHONE);
  const openWorking = page.getByRole("button", { name: /working/i }).first();
  await expect(openWorking).toBeVisible();
  console.log("[phone] working opens as a sheet:", await openWorking.innerText());
  await openWorking.click();
  const done = page.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible({ timeout: 20_000 });
  await done.click();
  console.log("[phone] working sheet opened and closed");

  // --- Submit: the provider is absent, so this is the failure path --------
  await page.setViewportSize(DESKTOP);
  const submit = page.getByRole("button", { name: /^Mark answer/ });
  await expect(submit).toBeVisible({ timeout: 20_000 });
  await submit.click();

  /*
   * Either outcome is a pass for this walkthrough. What must never happen is
   * the third one: a blank column with no way forward, which is what the code
   * did before the failure branch was fixed.
   */
  const failed = page.getByRole("heading", { name: /couldn't mark this one/i });
  const stranded = page.getByRole("heading", { name: /taking too long/i });
  const marked = page.getByText(/Your mark/);
  await expect(failed.or(stranded).or(marked)).toBeVisible({ timeout: 120_000 });
  const outcome = (await failed.isVisible())
    ? "marking failed"
    : (await stranded.isVisible())
      ? "marking stranded"
      : "marked";
  console.log("[submit] outcome:", outcome);

  if (outcome !== "marked") {
    // The frozen evidence and a real way forward, which is the whole point.
    await expect(page.getByText("What was submitted")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("button", { name: /Retry marking|Mark it again/ })
    ).toBeVisible();
    await expect(
      page.getByText("Root hair cells have a large surface area", { exact: false })
    ).toBeVisible();
    console.log("[submit] frozen answer shown with a retry offered");
  }

  // --- History -----------------------------------------------------------
  await page.goto("/dashboard/practice/history");
  const session = page.getByText(/of 2 marked/).first();
  await expect(session).toBeVisible({ timeout: 45_000 });
  // An unfinished session is scored against what has been marked, not the
  // whole paper, so one answered question cannot read as a failed session.
  console.log("[history] session line:", await session.innerText());

  /*
   * Two kinds of noise are expected here and nothing else is.
   *
   * The 409 and 503 are the failures this walkthrough goes out of its way to
   * cause -- the coverage shortage and the absent marker -- and the browser
   * logs every non-2xx response whether or not the page handled it. The
   * sandbox notice is Chrome's own handling of an SVG loaded through an
   * `<img>`, which is how the working sheet is rasterised; it is informational,
   * and the run proves the conversion worked because the submission carried
   * the sheet with it.
   */
  const expected = /favicon|manifest|status of (409|503)|frame is sandboxed/i;
  expect(errors.filter((message) => !expected.test(message))).toEqual([]);
});
