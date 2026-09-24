import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { expect, test, type Page } from "@playwright/test";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { E2E_FOLDER_ID, E2E_PROJECT_ID, E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

/**
 * The revision plan, on Home and in the planner, at the three widths students
 * use them at.
 *
 * A plan is seeded for this spec alone and removed after it: a running plan
 * changes what Home leads with, and every other spec expects Home without one.
 * The engine has nothing to suggest in the emulator, which is the case worth
 * seeing anyway -- a new student's first day -- so the walkthrough adds the
 * student's own task and checks it becomes the thing to do next.
 */

const PLAN_ID = "e2e-plan";

function studyDayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function uidFor(email: string, password: string) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-browser-api-key`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  return ((await response.json()) as { localId: string }).localId;
}

let environment: RulesTestEnvironment;
let uid: string;

test.beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: E2E_PROJECT_ID });
  uid = await uidFor(E2E_USER_EMAIL, E2E_USER_PASSWORD);
  const weekday = new Date().getDay();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", uid, "revisionPlans", PLAN_ID), {
      schemaVersion: 2,
      title: "Mocks in November",
      status: "active",
      origin: "manual",
      startDayKey: studyDayKey(-3),
      endDayKey: studyDayKey(55),
      scopes: [{ folderId: E2E_FOLDER_ID, weight: 2 }],
      sessions: [
        { id: "today-1", weekday, minutes: 60, startTime: "16:30", scopeKey: `folder:${E2E_FOLDER_ID}` },
        { id: "tomorrow", weekday: (weekday + 1) % 7, minutes: 45, startTime: "10:00" },
      ],
      emphasis: [],
      exams: [{ id: "exam-1", label: "Chemistry Paper 1", dayKey: studyDayKey(49), scopeKey: `folder:${E2E_FOLDER_ID}` }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
});

test.afterAll(async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), "users", uid, "revisionPlans", PLAN_ID, "entries", studyDayKey()));
    await deleteDoc(doc(context.firestore(), "users", uid, "revisionPlans", PLAN_ID));
  });
  await environment.cleanup();
});

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth));
  expect(scrollWidth, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(width + 1);
}

test("the plan leads Home and the planner at every width", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await expect(page.getByRole("link", { name: "Open your plan" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("navigation", { name: "This week in your plan" })).toBeVisible();
  await expect(page.getByText("Chemistry Paper 1")).toBeVisible();

  // A student's own task, added to today's session, becomes the next thing to do.
  await page.getByLabel(/Add your own task to/).fill("Redo question 3 from Monday's paper");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Redo question 3 from Monday's paper", level: 2 })).toBeVisible();
  await expect(page.getByText("You added").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, 1440);
  await page.screenshot({ path: "test-results/plan-home-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Redo question 3 from Monday's paper", level: 2 })).toBeVisible({ timeout: 45_000 });
  await expectNoHorizontalOverflow(page, 820);
  await page.screenshot({ path: "test-results/plan-home-tablet.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Redo question 3 from Monday's paper", level: 2 })).toBeVisible({ timeout: 45_000 });
  await expectNoHorizontalOverflow(page, 390);
  await page.screenshot({ path: "test-results/plan-home-phone.png", fullPage: true });

  // The planner: the week, today in full, and what it is counting down to.
  for (const [width, height, name] of [[1440, 1000, "desktop"], [820, 1180, "tablet"], [390, 844, "phone"]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard/tutor/plan");
    await expect(page.getByRole("heading", { name: "This week" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Counting down" })).toBeVisible();
    await expect(page.getByText("Redo question 3 from Monday's paper")).toBeVisible();
    await expectNoHorizontalOverflow(page, width);
    await page.screenshot({ path: `test-results/plan-planner-${name}.png`, fullPage: true });
  }

  // Tomorrow: its session shows, and Jami's part of it is decided on the day.
  const days = page.locator("button[aria-pressed]");
  await expect(days).toHaveCount(7);
  const todayIndex = (new Date().getDay() + 6) % 7;
  // On a Sunday, tomorrow is next week and not in this row.
  if (todayIndex < 6) {
    await days.nth(todayIndex + 1).click();
    await expect(page.getByText("Jami fills this in on the day").first()).toBeVisible();
  }

  expect(errors, errors.join("\n")).toEqual([]);
});
