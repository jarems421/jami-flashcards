import PDFDocument from "pdfkit";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_NOTEBOOK_ID,
  E2E_PAGE_IDS,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "./fixtures";

/** A three-page question paper, made here so the walkthrough needs no file checked in. */
function threePagePdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (let page = 1; page <= 3; page += 1) {
      if (page > 1) doc.addPage();
      doc.fontSize(28).text(`Question ${page}`);
      doc.moveDown().fontSize(12).text(`Small print on page ${page}: show that 0A is the zero matrix.`);
    }
    doc.end();
  });
}

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

test("a PDF uploaded beside the page opens there, turns its pages, and zooms", async ({ page }, testInfo) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto(`/dashboard/notebooks/${E2E_NOTEBOOK_ID}?page=${E2E_PAGE_IDS[0]}`);
  await expect(page.getByTestId("notebook-editor")).toHaveAttribute("data-notebook-ink-ready", "true");

  await page.getByRole("button", { name: "Keep a sheet beside the page" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByText("Upload a PDF or picture")).toBeVisible();
  await picker.locator('input[type="file"]').setInputFiles({
    name: "Paper 1.pdf",
    mimeType: "application/pdf",
    buffer: await threePagePdf(),
  });

  const sheet = page.getByRole("complementary", { name: "Sheet beside page: Paper 1" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText("From this folder")).toBeVisible();
  await expect(sheet.getByText("1 / 3")).toBeVisible();
  const firstPage = sheet.getByLabel("Page 1 of 3");
  await expect(firstPage).toBeVisible();
  const fitted = (await firstPage.boundingBox())!.width;

  await sheet.getByRole("button", { name: "Zoom in" }).click();
  await sheet.getByRole("button", { name: "Zoom in" }).click();
  await expect(sheet.getByText("156%")).toBeVisible();
  await expect.poll(async () => (await firstPage.boundingBox())!.width).toBeGreaterThan(fitted * 1.5);

  // Zoomed, the arrows still turn the page.
  await sheet.getByRole("button", { name: "Next page" }).click();
  await expect(sheet.getByText("2 / 3")).toBeVisible();
  await expect(sheet.getByLabel("Page 2 of 3")).toBeInViewport();
  await sheet.screenshot({ path: testInfo.outputPath("zoomed-page-2.png") });
  await testInfo.attach("zoomed-page-2", { path: testInfo.outputPath("zoomed-page-2.png"), contentType: "image/png" });

  // Ctrl and the wheel, as a trackpad pinch arrives, zoom further.
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect(sheet.getByText(/^(?:1[6-9]\d|2\d\d|300)%$/)).toBeVisible();

  await sheet.getByRole("button", { name: "Fit the sheet to the panel" }).click();
  await expect(sheet.getByText("100%")).toBeVisible();
  await sheet.getByRole("button", { name: "Next page" }).click();
  await expect(sheet.getByText("3 / 3")).toBeVisible();
  await sheet.screenshot({ path: testInfo.outputPath("fitted-page-3.png") });
  await testInfo.attach("fitted-page-3", { path: testInfo.outputPath("fitted-page-3.png"), contentType: "image/png" });

  // The upload is now one of the folder's sheets, offered again from the picker.
  await sheet.getByRole("button", { name: "Keep another sheet beside the page" }).click();
  await expect(page.getByRole("dialog").getByText("In this folder")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Paper 1/ })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
