import { expect, test, type Page } from "@playwright/test";
import {
  E2E_FOLDER_ID,
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_TEXT_MARKER,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function openNotebook(page: Page, pageId = E2E_PAGE_IDS[0]) {
  await page.goto(
    `/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${pageId}`
  );
  const editor = page.getByTestId("notebook-editor");
  await expect(editor).toHaveAttribute("data-notebook-id", E2E_NOTEBOOK_ID);
  await expect(editor).toHaveAttribute(
    "data-notebook-selected-page-id",
    pageId
  );
  await expect(editor).toHaveAttribute("data-notebook-ink-ready", "true");
  await expect(
    page.getByRole("status", { name: "All changes saved" })
  ).toBeVisible();
  return editor;
}

test("signed-in notebook work autosaves and survives navigation and reload", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const editor = await openNotebook(page);

  await page.getByRole("button", { name: "Text box (T)" }).click();
  const drawingSurface = page.getByRole("img", {
    name: "Notebook drawing page",
  });
  const textSurfaceBox = await drawingSurface.boundingBox();
  expect(textSurfaceBox).not.toBeNull();
  await page.mouse.click(
    textSurfaceBox!.x + textSurfaceBox!.width * 0.52,
    textSurfaceBox!.y + textSurfaceBox!.height * 0.42
  );
  await page.locator("[data-notebook-text-editor='true']").fill(E2E_TEXT_MARKER);
  await expect(
    page.getByRole("status", { name: "Unsaved changes" })
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "All changes saved" })
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(editor).toHaveAttribute(
    "data-notebook-selected-page-id",
    E2E_PAGE_IDS[1]
  );
  await expect(page).toHaveURL(
    new RegExp(`page=${E2E_PAGE_IDS[1]}(?:&|$)`)
  );
  await expect(editor).toHaveAttribute("data-notebook-ink-ready", "true");

  await page.getByRole("button", { name: "Pen (P)" }).click();
  const inkSurfaceBox = await drawingSurface.boundingBox();
  expect(inkSurfaceBox).not.toBeNull();
  const startX = inkSurfaceBox!.x + inkSurfaceBox!.width * 0.35;
  const startY = inkSurfaceBox!.y + inkSurfaceBox!.height * 0.4;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(
    startX + Math.min(140, inkSurfaceBox!.width * 0.2),
    startY + Math.min(90, inkSurfaceBox!.height * 0.14),
    { steps: 8 }
  );
  await page.mouse.up();
  await expect(editor).toHaveAttribute("data-notebook-has-ink", "true");
  await expect(
    page.getByRole("status", { name: "All changes saved" })
  ).toBeVisible({ timeout: 15_000 });

  const toolbar = page.getByRole("toolbar", { name: "Drawing tools" });
  const penControlBox = await page
    .getByRole("button", { name: "Pen (P)" })
    .boundingBox();
  expect(penControlBox).not.toBeNull();
  await page.mouse.move(
    penControlBox!.x + penControlBox!.width / 2,
    penControlBox!.y + penControlBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    penControlBox!.x + penControlBox!.width / 2 + 12,
    penControlBox!.y + penControlBox!.height / 2,
    { steps: 2 }
  );
  await expect(toolbar).toHaveAttribute("data-toolbar-dragging", "true");
  await page.mouse.move(
    18,
    inkSurfaceBox!.y + inkSurfaceBox!.height / 2,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(toolbar).toHaveAttribute("data-toolbar-dock", "left");
  await expect(toolbar).toHaveAttribute("aria-orientation", "vertical");

  await page.reload();
  await expect(editor).toHaveAttribute(
    "data-notebook-selected-page-id",
    E2E_PAGE_IDS[1]
  );
  await expect(editor).toHaveAttribute("data-notebook-ink-ready", "true");
  await expect(editor).toHaveAttribute("data-notebook-has-ink", "true");
  await expect(toolbar).toHaveAttribute("data-toolbar-dock", "left");

  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(editor).toHaveAttribute(
    "data-notebook-selected-page-id",
    E2E_PAGE_IDS[0]
  );
  await expect(
    page.locator(".notebook-text-object").filter({ hasText: E2E_TEXT_MARKER })
  ).toBeVisible();

  await page.getByRole("link", { name: "Back to folder" }).click();
  await expect(page).toHaveURL(`/dashboard/folders/${E2E_FOLDER_ID}`, {
    timeout: 60_000,
  });
  expect(pageErrors).toEqual([]);
});

test("tablet keeps notebook controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await signIn(page);
  await openNotebook(page);

  await expect(
    page.getByRole("toolbar", { name: "Drawing tools" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Pages" }).click();
  await expect(page.getByRole("button", { name: "Open page 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New page" })).toBeVisible();
  await page.getByRole("button", { name: "Open page 1" }).click();
  await expect(page.getByRole("button", { name: "Open page 1" })).toBeHidden();
  await expect(
    page.getByLabel("Page navigation")
  ).toBeVisible();
});

test("phone stays in light editing mode by default", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openNotebook(page);

  await expect(
    page.getByText(
      "Notebook editing works best on iPad or desktop.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue anyway" })
  ).toBeVisible();
  await expect(
    page.getByRole("toolbar", { name: "Drawing tools" })
  ).toHaveCount(0);
});
