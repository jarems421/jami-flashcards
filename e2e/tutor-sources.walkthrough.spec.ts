import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SOURCE,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

const screenshotDirectory = "test-results/tutor-sources";

/**
 * Asking Tutor about several sources at once, and saving the cards it offers.
 *
 * The browser suite has no AI provider, so the assistant's reply is stubbed at
 * the network. What this proves is everything around it: that several sources
 * can be chosen, that all of them reach the request, and that a suggested card
 * saves into the drafts queue of the source it came from.
 */

const EXTRA_SOURCES = [
  { id: "e2e-source-cells", title: "Cell transport notes" },
  { id: "e2e-source-enzymes", title: "Enzymes chapter summary" },
];

function requireEmulatorHost(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing. Run the suite through npm run test:e2e.`);
  return value;
}

async function signedInUserId() {
  const response = await fetch(
    `http://${requireEmulatorHost("FIREBASE_AUTH_EMULATOR_HOST")}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-browser-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: E2E_USER_EMAIL,
        password: E2E_USER_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  const body = (await response.json()) as { localId?: string };
  if (!body.localId) throw new Error("Could not resolve the browser-suite user.");
  return body.localId;
}

function firestoreDocumentUrl(path: string) {
  return `http://${requireEmulatorHost("FIRESTORE_EMULATOR_HOST")}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function seedSource(userId: string, source: { id: string; title: string }) {
  const now = String(Date.now());
  const response = await fetch(firestoreDocumentUrl(`users/${userId}/sources/${source.id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({
      fields: {
        title: { stringValue: source.title },
        type: { stringValue: "manual_note" },
        subject: { stringValue: "Biology" },
        folderIds: { arrayValue: { values: [] } },
        topicIds: { arrayValue: { values: [] } },
        contentText: { stringValue: `Notes for ${source.title}.` },
        status: { stringValue: "active" },
        createdBy: { stringValue: "user" },
        createdAt: { integerValue: now },
        updatedAt: { integerValue: now },
      },
    }),
  });
  if (!response.ok) throw new Error(`Seeding ${source.id} failed: ${response.status}`);
}

async function draftsFor(userId: string, sourceId: string) {
  const response = await fetch(
    `${firestoreDocumentUrl(`users/${userId}`)}:runQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "generatedContentDrafts" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "sourceId" },
              op: "EQUAL",
              value: { stringValue: sourceId },
            },
          },
        },
      }),
    }
  );
  const rows = (await response.json()) as Array<{
    document?: { fields: Record<string, { stringValue?: string }> };
  }>;
  return rows.flatMap((row) => (row.document ? [row.document.fields] : []));
}

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

test("several sources go to Tutor together, and an offered card saves as a draft", async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  const userId = await signedInUserId();
  await Promise.all(EXTRA_SOURCES.map((source) => seedSource(userId, source)));

  const sentBodies: Array<{ context?: { surface?: string; sourceIds?: string[] }; message?: string }> = [];
  await page.route("**/api/ai/assistant", async (route) => {
    sentBodies.push(route.request().postDataJSON());
    const done = {
      type: "done",
      reply: "These three cards cover how substances cross a membrane, across your notes.",
      used: [
        { kind: "source", id: EXTRA_SOURCES[0].id, label: EXTRA_SOURCES[0].title },
        { kind: "general-knowledge", label: "general knowledge" },
      ],
      suggestedCards: [
        {
          front: "Why does a plant cell in pure water not burst?",
          back: "The cell wall resists the water moving in, so the cell becomes turgid instead.",
          sourceId: EXTRA_SOURCES[0].id,
          sourceTitle: EXTRA_SOURCES[0].title,
          topicIds: [],
        },
        {
          front: "How does active transport differ from diffusion?",
          back: "It moves substances against their concentration gradient, using energy from respiration.",
          sourceId: EXTRA_SOURCES[0].id,
          sourceTitle: EXTRA_SOURCES[0].title,
          topicIds: [],
        },
        {
          front: "What happens to an enzyme's active site at a high temperature?",
          back: "It changes shape, so the substrate no longer fits and the enzyme is denatured.",
          sourceId: EXTRA_SOURCES[1].id,
          sourceTitle: EXTRA_SOURCES[1].title,
          topicIds: [],
        },
      ],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "text", value: done.reply })}\n${JSON.stringify(done)}\n`,
    });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.goto("/dashboard/library");
  const list = page.getByRole("navigation", { name: "Saved sources" });
  await expect(list.getByRole("button", { name: /Cell transport notes/ })).toBeVisible({
    timeout: 45_000,
  });

  // Read one source first: select mode starts from the source being read.
  await list.getByRole("button", { name: new RegExp(E2E_SOURCE.title) }).click();
  await page.getByRole("button", { name: "Select several" }).click();
  for (const title of [EXTRA_SOURCES[0].title, EXTRA_SOURCES[1].title]) {
    await list.getByRole("button", { name: new RegExp(title) }).click();
  }
  // The source being read when select mode began is chosen already.
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/select-desktop.png` });

  for (const [name, width, height] of [
    ["tablet", 834, 1100],
    ["phone", 390, 860],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${screenshotDirectory}/select-${name}.png` });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Ask Jami", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect the ideas" })).toBeVisible({
    timeout: 20_000,
  });
  const notice = page.getByRole("button", { name: "I understand" });
  if (await notice.isVisible()) await notice.click();
  await page.screenshot({ path: `${screenshotDirectory}/drawer-several-desktop.png` });

  await page.getByRole("button", { name: "Suggest flashcards" }).click();
  const cards = page.getByRole("region", { name: "Suggested flashcards" });
  await expect(cards).toBeVisible({ timeout: 20_000 });
  expect(sentBodies[0]?.context).toEqual({
    surface: "sources",
    sourceIds: expect.arrayContaining([E2E_SOURCE.id, ...EXTRA_SOURCES.map((source) => source.id)]),
  });
  expect(sentBodies[0]?.context?.sourceIds).toHaveLength(3);

  await cards.getByRole("button", { name: "Save to drafts", exact: true }).first().click();
  await expect(cards.getByText("Saved to drafts", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(cards.getByRole("link", { name: `Review drafts from ${EXTRA_SOURCES[0].title}` })).toBeVisible();
  await page.screenshot({ path: `${screenshotDirectory}/cards-desktop.png` });

  for (const [name, width, height] of [
    ["tablet", 834, 1100],
    ["phone", 390, 860],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await cards.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${screenshotDirectory}/cards-${name}.png` });
  }

  const saved = await draftsFor(userId, EXTRA_SOURCES[0].id);
  expect(saved).toEqual([
    expect.objectContaining({
      kind: { stringValue: "flashcard" },
      sourceType: { stringValue: "source" },
      contentStatus: { stringValue: "draft" },
      front: { stringValue: "Why does a plant cell in pure water not burst?" },
    }),
  ]);
  expect(errors).toEqual([]);
});
