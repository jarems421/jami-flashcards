import { expect, test, type Page } from "@playwright/test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { E2E_PROJECT_ID } from "./fixtures";

const WALKTHROUGH_EMAIL = "release-one-walkthrough@jami.test";
const WALKTHROUGH_PASSWORD = "Release-one-walkthrough-password-2026";

function requireEmulatorHost(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing. Run this through npm run test:e2e.`);
  }
  return value;
}

async function createEmptyWalkthroughAccount() {
  const authHost = requireEmulatorHost("FIREBASE_AUTH_EMULATOR_HOST");
  requireEmulatorHost("FIRESTORE_EMULATOR_HOST");

  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-browser-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: WALKTHROUGH_EMAIL,
        password: WALKTHROUGH_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  const result = (await response.json()) as {
    error?: { message?: string };
    localId?: string;
  };
  if (!response.ok || !result.localId) {
    throw new Error(
      `Could not create walkthrough account: ${
        result.error?.message ?? response.status
      }`
    );
  }

  const environment = await initializeTestEnvironment({
    projectId: E2E_PROJECT_ID,
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const now = Date.now();
      await setDoc(doc(context.firestore(), "users", result.localId!), {
        topicsMigrationVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(
        doc(
          context.firestore(),
          "users",
          result.localId!,
          "onboarding",
          "release-1"
        ),
        {
          version: 1,
          status: "active",
          currentMissionId: "create-folder",
          completedMissionIds: [],
          context: {},
          rewardState: "not-earned",
          updatedAt: now,
        }
      );
    });
  } finally {
    await environment.cleanup();
  }

  return result.localId;
}

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(WALKTHROUGH_EMAIL);
  await page.getByLabel("Password").fill(WALKTHROUGH_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

function quest(page: Page) {
  return page.getByTestId("tutorial-quest");
}

async function expectMission(page: Page, number: number, title: string) {
  await expect(quest(page)).toContainText(`Mission ${number} of 7`, {
    timeout: 45_000,
  });
  await expect(quest(page)).toContainText(title);
}

function ratingButton(page: Page, rating: "Good" | "Again") {
  return page.getByRole("button", { name: new RegExp(`^${rating}\\b`) });
}

test("a new student can complete all seven first-loop missions", async ({
  page,
}) => {
  const userId = await createEmptyWalkthroughAccount();
  const folderName = "Walkthrough Biology";
  const notebookName = "Walkthrough notes";
  const deckName = "Walkthrough cards";
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/ai/assistant", async (route) => {
    const reply = "Cell membranes control what enters and leaves the cell.";
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: [
        JSON.stringify({ type: "text", value: reply }),
        JSON.stringify({
          type: "done",
          reply,
          used: [
            {
              kind: "current-context",
              label: "Current notebook page",
            },
          ],
        }),
      ].join("\n"),
    });
  });

  await signIn(page);
  await page.goto("/dashboard/practice");
  await expectMission(page, 1, "Give a subject a home");

  await page.locator('[data-tutorial-target="create-folder"]').click();
  const folderDialog = page.getByRole("dialog");
  await folderDialog.getByLabel("Folder name").fill(folderName);
  await folderDialog.getByRole("button", { name: "Create folder" }).click();
  await expectMission(page, 2, "Open a place to work");
  await page.getByRole("link", { name: folderName }).click();

  const createNotebookButtons = page.getByRole("button", {
    name: "Create notebook",
    exact: true,
  });
  await expect(createNotebookButtons.first()).toBeVisible({ timeout: 45_000 });
  await createNotebookButtons.first().click();
  await page.getByLabel("Notebook title").fill(notebookName);
  await page.getByTestId("create-notebook-submit").click();
  await expectMission(page, 3, "Put something on the page");
  await page.getByRole("link", { name: new RegExp(notebookName) }).click();

  const editor = page.getByTestId("notebook-editor");
  await expect(editor).toHaveAttribute("data-notebook-ink-ready", "true", {
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "Text box (T)" }).click();
  const drawingSurface = page.getByRole("img", {
    name: "Notebook drawing page",
  });
  const surfaceBox = await drawingSurface.boundingBox();
  expect(surfaceBox).not.toBeNull();
  await page.mouse.click(
    surfaceBox!.x + surfaceBox!.width * 0.5,
    surfaceBox!.y + surfaceBox!.height * 0.4
  );
  await page
    .locator("[data-notebook-text-editor='true']")
    .fill("The phospholipid bilayer is selectively permeable.");
  await expect(
    page.getByRole("status", { name: "All changes saved" })
  ).toBeVisible({ timeout: 15_000 });
  await expectMission(page, 4, "Make a place for memory");

  await quest(page).getByRole("button", { name: "Create a deck" }).click();
  await page.getByPlaceholder("Deck name").fill(deckName);
  await page.getByRole("button", { name: "Create deck", exact: true }).click();
  await expectMission(page, 5, "Keep one useful idea");
  await quest(page).getByRole("button", { name: "Add a card" }).click();

  await page
    .getByRole("textbox", { name: "Front", exact: true })
    .fill("What does a cell membrane control?");
  await page
    .getByRole("textbox", { name: "Back", exact: true })
    .fill("What enters and leaves the cell.");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await expectMission(page, 6, "Bring it back once");
  await quest(page).getByRole("button", { name: "Start review" }).click();

  await page.getByRole("button", { name: "Start Daily Review" }).click();
  const flashcard = page.locator("[data-study-current-card-id]");
  await expect(flashcard).toBeVisible({ timeout: 45_000 });
  await flashcard.click();
  await ratingButton(page, "Good").click();
  await expectMission(page, 7, "Ask beside your work");
  await quest(page).getByRole("button", { name: "Open notebook" }).click();

  await expect(editor).toHaveAttribute("data-notebook-ink-ready", "true", {
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "Jami Tutor" }).click();
  await page.getByPlaceholder("Ask Jami...").fill("Why is this useful?");
  await page.getByRole("button", { name: "Send message to Jami" }).click();

  await expect(
    page.getByText("Cell membranes control what enters and leaves the cell.")
  ).toBeVisible({ timeout: 45_000 });
  const reward = page.locator(".star-reward-overlay");
  await expect(reward).toBeVisible({ timeout: 45_000 });
  await page.screenshot({
    path: "test-results/release-one-walkthrough-reward.png",
  });
  await page.locator(".star-reward-card").click();
  await expect(reward).toBeHidden({ timeout: 5_000 });
  await expect(page.getByTestId("tutorial-completion")).toContainText(
    "Your first loop is complete."
  );
  await page.screenshot({
    path: "test-results/release-one-walkthrough-complete.png",
  });

  const environment = await initializeTestEnvironment({
    projectId: E2E_PROJECT_ID,
  });
  try {
    await environment.withSecurityRulesDisabled(async (context) => {
      const progress = await getDoc(
        doc(context.firestore(), "users", userId, "onboarding", "release-1")
      );
      expect(progress.data()?.status).toBe("completed");
      expect(progress.data()?.completedMissionIds).toHaveLength(7);
      expect(progress.data()?.rewardState).toBe("awarded");
    });
  } finally {
    await environment.cleanup();
  }

  expect(pageErrors).toEqual([]);
});
