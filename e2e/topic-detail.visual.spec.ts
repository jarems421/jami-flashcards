import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

/**
 * The Topic detail screen, driven at the three widths the design system asks
 * about.
 *
 * The screen used to put every card, notebook, source and draft in the
 * workspace into one list with Add/Remove beside each row, so opening a Topic
 * showed mostly material that had nothing to do with it. The redesign shows
 * only what is in the Topic and moves everything else behind an Add button, so
 * the check that matters here is an outsider being absent from the list until
 * the picker is open.
 *
 * It seeds its own topic, deck, cards and source rather than reusing the shared
 * fixture: the shared Topic is deliberately thin, and linking the shared cards
 * to it would make the browse and study smokes order-dependent.
 */

const TOPIC = { id: "e2e-detail-topic", name: "Enzyme kinetics" };
const DECK = { id: "e2e-detail-deck", name: "Topic detail deck" };
const SOURCE = { id: "e2e-detail-source", title: "Enzyme kinetics handout" };

/** In the Topic. */
const MEMBER_CARDS = [
  { id: "e2e-detail-card-1", front: "What does Km measure?" },
  { id: "e2e-detail-card-2", front: "What does Vmax measure?" },
  { id: "e2e-detail-card-3", front: "Name a competitive inhibitor" },
];

/**
 * Not in the Topic, and in a deck of its own so the Cards tab has something
 * that must stay off screen until the picker opens.
 */
const OUTSIDER_CARD = {
  id: "e2e-detail-card-outsider",
  front: "Unrelated card about the Treaty of Versailles",
};

async function seedTopic() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!authHost) {
    throw new Error("Run this through npm run test:e2e.");
  }

  const signIn = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-browser-api-key`,
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
  const result = (await signIn.json()) as { localId?: string };
  const userId = result.localId;
  if (!userId) throw new Error("Could not resolve the seeded user.");

  const environment = await initializeTestEnvironment({ projectId: E2E_PROJECT_ID });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = 1_800_000_000_000;
    /*
     * Far enough ahead that these cards are never due. A due card here would
     * be handed out by Daily Review and break the study smoke, which grades
     * its own deck to empty.
     */
    const notDueUntil = Date.now() + 365 * 24 * 60 * 60 * 1000;

    await setDoc(doc(db, "users", userId, "topics", TOPIC.id), {
      name: TOPIC.name,
      normalizedName: TOPIC.name.toLowerCase(),
      slug: "enzyme-kinetics",
      subject: "Biology",
      status: "active",
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, "users", userId, "sources", SOURCE.id), {
      title: SOURCE.title,
      type: "manual_note",
      subject: "Biology",
      folderIds: [],
      topicIds: [TOPIC.id],
      contentText: "Rates, saturation, and inhibition.",
      status: "active",
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, "decks", DECK.id), {
      name: DECK.name,
      userId,
      createdAt: now,
      colorPreset: "violet",
      iconPreset: "sparkles",
      folderIds: [],
    });

    await Promise.all(
      [
        ...MEMBER_CARDS.map((card) => ({ card, topicIds: [TOPIC.id] })),
        { card: OUTSIDER_CARD, topicIds: [] as string[] },
      ].map(({ card, topicIds }, index) =>
        setDoc(doc(db, "cards", card.id), {
          deckId: DECK.id,
          userId,
          front: card.front,
          back: "Seeded for the Topic detail screen.",
          createdAt: now + index,
          tags: [],
          topicIds,
          fsrsState: 2,
          reps: 3,
          lapses: 0,
          dueDate: notDueUntil,
        })
      )
    );
  });
  await environment.cleanup();
}

async function signInBrowser(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function openTopic(page: Page) {
  await page.goto(`/dashboard/topics/${TOPIC.id}`);
  // The top bar carries the Topic name, so a wrong or missing Topic is visible
  // here rather than three assertions later.
  await expect(
    page.getByRole("heading", { name: TOPIC.name, level: 1 })
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(MEMBER_CARDS[0].front).first()).toBeVisible({
    timeout: 45_000,
  });
}

test("a Topic shows its own material and nothing else", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await seedTopic();
  await signInBrowser(page);
  await openTopic(page);

  // The Topic's own name, said plainly, is the thing the old screen buried.
  await expect(
    page.getByRole("heading", { name: TOPIC.name, level: 2 })
  ).toBeVisible();

  // It opens on Cards because Cards is the first tab with anything in it.
  for (const card of MEMBER_CARDS) {
    await expect(page.getByText(card.front).first()).toBeVisible();
  }

  // The whole point of the redesign: workspace material that is not in this
  // Topic stays out of the list.
  await expect(page.getByText(OUTSIDER_CARD.front)).toHaveCount(0);

  // Switching tabs keeps that promise for the other three kinds.
  await page.getByRole("button", { name: /^Sources/ }).click();
  await expect(page.getByText(SOURCE.title).first()).toBeVisible();
  await expect(page.getByText(MEMBER_CARDS[0].front)).toHaveCount(0);

  // An empty tab says so rather than filling itself with everything else.
  await page.getByRole("button", { name: /^Notebooks/ }).click();
  await expect(
    page.getByText("No notebooks in this Topic yet")
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test("material joins and leaves a Topic through the picker", async ({ page }) => {
  await seedTopic();
  await signInBrowser(page);
  await openTopic(page);

  await page.getByRole("button", { name: "Add cards" }).click();
  await page
    .getByLabel("Search cards to add")
    .fill("Versailles");

  const add = page.getByRole("button", {
    name: `Add ${OUTSIDER_CARD.front} to ${TOPIC.name}`,
  });
  await expect(add).toBeVisible({ timeout: 30_000 });
  await add.click();

  // Once added it belongs to the Topic, so it leaves the picker and joins the
  // list below it.
  const remove = page.getByRole("button", {
    name: `Remove ${OUTSIDER_CARD.front} from ${TOPIC.name}`,
  });
  await expect(remove).toBeVisible({ timeout: 30_000 });
  await expect(add).toHaveCount(0);

  // Put the seeded data back, so the shot in the other test is not a card
  // richer depending on the order the suite ran in.
  await remove.click();
  await expect(remove).toHaveCount(0);
});

test("the Topic screen holds up at every width", async ({ page }) => {
  await seedTopic();
  await signInBrowser(page);
  await openTopic(page);

  for (const [name, width, height] of [
    ["desktop", 1280, 1000],
    ["tablet", 834, 1100],
    ["phone", 390, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `e2e-screens/topic-detail-${name}.png`,
      fullPage: true,
    });

    // Content wider than the viewport is the classic phone regression, and the
    // tab row is the part of this screen most likely to cause it.
    const main = page.locator("main").first();
    const box = await main.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(width);
  }

  // The picker is the other half of the screen, and it only exists when open.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole("button", { name: "Add cards" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "e2e-screens/topic-detail-picker.png",
    fullPage: true,
  });
});
