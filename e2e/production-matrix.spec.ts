import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_FOLDER_ID,
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_SOURCE,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";
import { FLASHCARDS_TITLE } from "@/lib/app/flashcard-views";

type Surface = {
  name: string;
  path: string;
  ready: (page: Page) => Locator;
};

const surfaces: Surface[] = [
  {
    name: "Today",
    path: "/dashboard",
    // Was "Your next study step", a line that no longer exists anywhere in the
    // app. A readiness check pinned to body copy fails the moment the copy is
    // reworded, and says nothing about whether the screen loaded.
    ready: (page) => page.getByRole("heading", { name: "Today", level: 1 }),
  },
  {
    name: "folder",
    path: `/dashboard/folders/${E2E_FOLDER_ID}`,
    ready: (page) =>
      page.getByRole("heading", { name: "Browser smoke folder", level: 1 }),
  },
  {
    name: "Sources",
    path: "/dashboard/library",
    ready: (page) => page.getByText(E2E_SOURCE.title).first(),
  },
  {
    name: "notebook",
    path: `/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`,
    ready: (page) => page.getByTestId("notebook-editor"),
  },
  {
    name: "Learn",
    path: "/dashboard/study",
    ready: (page) => page.getByRole("heading", { name: "Learn", level: 1 }),
  },
  {
    name: "Cards",
    path: "/dashboard/cards",
    ready: (page) =>
      page.getByRole("heading", { name: FLASHCARDS_TITLE, level: 1 }),
  },
  {
    name: "Practice",
    path: "/dashboard/practice",
    ready: (page) => page.getByRole("heading", { name: "Folders", level: 1 }),
  },
  {
    name: "Account",
    path: "/dashboard/profile",
    ready: (page) => page.getByRole("heading", { name: "Account", level: 1 }),
  },
];

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function assertNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(dimensions.viewport).toBe(viewportWidth);
  expect(
    Math.max(dimensions.body, dimensions.document),
    "The surface must not extend beyond the configured viewport."
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "phone", width: 390, height: 844 },
] as const) {
  test(`${viewport.name} production surface matrix stays usable`, async ({
    page,
  }) => {
    test.setTimeout(480_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    for (const surface of surfaces) {
      await test.step(surface.name, async () => {
        await page.goto(surface.path);
        await expect(surface.ready(page)).toBeVisible({ timeout: 45_000 });
        await assertNoHorizontalOverflow(page, viewport.width);
      });
    }

    expect(pageErrors).toEqual([]);
  });
}
