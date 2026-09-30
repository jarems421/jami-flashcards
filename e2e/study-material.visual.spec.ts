import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_FOLDER_ID,
  E2E_SOURCE,
  E2E_TUTOR_DRAFTS,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

const screenshotDirectory = "test-results/study-material";

/**
 * Study material Tutor makes in a chat, practice sets waiting in Practice, and
 * the Create panel's focus chat -- at the three widths the design system asks
 * about. The AI routes are answered here, so what is checked is the page, not
 * a model.
 */

const WIDTHS = [
  ["desktop", 1280, 1000],
  ["tablet", 834, 1100],
  ["phone", 390, 900],
] as const;

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function shootAtEveryWidth(page: Page, name: string) {
  for (const [label, width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${screenshotDirectory}/${name}-${label}.png` });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow, `${name} scrolls sideways at ${label}`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
}

function readySet(id: string, origin: string, title: string, questionCount: number, maxTotal: number) {
  return {
    id,
    userId: "user",
    folderId: E2E_FOLDER_ID,
    folderName: "Browser smoke folder",
    subject: "Calculus",
    studyLevel: "undergraduate",
    requestedMix: { easy: 2, medium: 2, hard: 1 },
    topicIds: [],
    conceptIds: [],
    questions: Array.from({ length: questionCount }, (_unused, index) => ({ id: `q${index}`, attemptId: `a${index}` })),
    status: "active",
    answeredCount: 0,
    awardedTotal: 0,
    maxTotal,
    practiceSet: { origin, status: "ready", title, focus: title },
    createdAt: 1,
    updatedAt: 1,
  };
}

test.beforeAll(() => mkdirSync(screenshotDirectory, { recursive: true }));

test("practice sets wait in Ready to practise", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await page.route("**/api/practice/practice-sets", (route) =>
    route.fulfill({
      json: {
        sets: [
          readySet("set-1", "tutor", "Separating variables: which side to divide", 5, 18),
          readySet("set-2", "source", "Integrating factors and when to use them", 3, 9),
        ],
      },
    })
  );
  await page.route("**/api/learning/study-actions", (route) =>
    route.fulfill({
      json: {
        actions: [
          {
            id: "folder:e2e-folder|low_confidence|topic",
            reason: "low_confidence",
            action: "diagnose",
            priority: 2.5,
            target: { kind: "topic", topicKey: "student-topic:e2e-topic", label: "Exact equations", source: "student-topic" },
            evidence: { count: 1, uniqueItems: 1, sources: ["practice"] },
            scope: { folderId: E2E_FOLDER_ID },
            explanationCode: "low_confidence.diagnose",
            destination: { kind: "topic", href: "/dashboard/topics/e2e-topic" },
          },
        ],
        folders: [{ id: E2E_FOLDER_ID, name: "Browser smoke folder" }],
        generatedAt: Date.now(),
      },
    })
  );

  await signIn(page);
  await page.goto("/dashboard/practice");
  const section = page.getByRole("heading", { name: "Ready to practise" });
  await expect(section).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Separating variables: which side to divide")).toBeVisible();
  await expect(page.getByText("Recommended by Jami")).toBeVisible();
  await section.scrollIntoViewIfNeeded();

  await shootAtEveryWidth(page, "ready-to-practise");
  expect(errors).toEqual([]);
});

test("Tutor makes flashcards in a source chat and they can be kept there", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  const savedThread = {
    id: "thread-e2e",
    title: "Make flashcards",
    surface: "sources",
    contextKey: `sources:${E2E_SOURCE.id}`,
    contextLabel: E2E_SOURCE.title,
    context: { surface: "sources", sourceIds: [E2E_SOURCE.id] },
    lastMessagePreview: "",
    messageCount: 2,
    createdAt: 1,
    updatedAt: 1,
    lastAssistantMessageId: "answer-e2e",
  };
  await page.route("**/api/ai/assistant", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson; charset=utf-8",
      body: [
        { type: "text", value: "Making you flashcards on separating variables now." },
        {
          type: "done",
          reply: "Making you flashcards on separating variables now.",
          used: [{ kind: "general-knowledge", label: "general knowledge" }],
          studyMaterialRequest: { kind: "flashcards", focus: "separating variables: which side to divide", count: 4 },
          studyMaterialOffers: ["practice"],
          savedThread,
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    })
  );
  let releaseMaterial: () => void = () => undefined;
  const materialReady = new Promise<void>((resolve) => (releaseMaterial = resolve));
  await page.route("**/api/ai/assistant/study-material", async (route) => {
    await materialReady;
    await route.fulfill({
      json: {
        result: {
          kind: "flashcards",
          draftIds: ["d1", "d2", "d3"],
          focus: "separating variables: which side to divide",
          folderId: E2E_FOLDER_ID,
          createdAt: Date.now(),
        },
        drafts: [
          { id: "d1", front: "In $\\frac{dy}{dx} = f(x)g(y)$, where does $g(y)$ go?", back: "To the $dy$ side, as $\\frac{1}{g(y)}\\,dy$." },
          { id: "d2", front: "What goes with $dx$ when separating variables?", back: "Every factor that depends only on $x$." },
          { id: "d3", front: "Why must you divide by $g(y)$ rather than multiply?", back: "So each side holds one variable and can be integrated on its own." },
        ],
      },
    });
  });

  await signIn(page);
  await page.goto(`/dashboard/library?source=${E2E_SOURCE.id}&panel=tutor`);
  const composer = page.getByLabel("Message Jami");
  await expect(composer).toBeVisible({ timeout: 45_000 });
  await composer.fill("can you make me flashcards on this?");
  await page.getByRole("button", { name: "Send message to Jami" }).click();

  await expect(page.getByText("Making your flashcards")).toBeVisible({ timeout: 20_000 });
  await shootAtEveryWidth(page, "tutor-flashcards-making");

  releaseMaterial();
  await expect(page.getByText("3 flashcards on separating variables")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Add all" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Practice questions" })).toBeVisible();
  await shootAtEveryWidth(page, "tutor-flashcards-ready");
  expect(errors).toEqual([]);
});

test("the Create panel takes a focus, and makes practice questions into a set", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await page.route("**/api/ai/study-material-brief", (route) =>
    route.fulfill({
      json: {
        reply: "Got it: I'll stick to the separable equations section and leave out the history of the method.",
        brief: "Only the separable equations section; skip the history.",
      },
    })
  );
  await page.route("**/api/practice/practice-sets", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 201,
          json: { session: readySet("set-e2e", "source", "Only the separable equations section", 3, 9) },
        })
      : route.fulfill({ json: { sets: [] } })
  );

  await signIn(page);
  await page.goto(`/dashboard/library?source=${E2E_SOURCE.id}&panel=drafts`);
  const focus = page.getByLabel("What should Jami focus on?");
  await expect(focus).toBeVisible({ timeout: 45_000 });
  await focus.fill("Just the separable equations bit, skip the history");
  await page.getByRole("button", { name: "Send to Jami" }).click();
  await expect(page.getByText("leave out the history of the method")).toBeVisible({ timeout: 20_000 });

  // Flashcards first, practice questions second.
  await page.getByRole("button", { name: "Make", exact: true }).nth(1).click();
  await expect(page.getByText("3 questions · 9 marks · waiting in Practice")).toBeVisible({ timeout: 20_000 });

  await shootAtEveryWidth(page, "create-panel");
  expect(errors).toEqual([]);
});

test("flashcards from a chat with no source are reviewed on the Tutor page", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await signIn(page);
  await page.goto("/dashboard/tutor");
  await expect(page.getByText("From your Tutor chats")).toBeVisible({ timeout: 45_000 });
  await page
    .locator("div")
    .filter({ has: page.getByText("From your Tutor chats", { exact: true }) })
    .getByRole("button", { name: "Review drafts" })
    .last()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(E2E_TUTOR_DRAFTS[0].front)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole("button", { name: "Add all" })).toBeVisible();
  // A deck from the folder the chat sat in is chosen for them.
  await expect(dialog.locator("select")).not.toHaveValue("");

  await shootAtEveryWidth(page, "tutor-page-review");
  expect(errors).toEqual([]);
});
