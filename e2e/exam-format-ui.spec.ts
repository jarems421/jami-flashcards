import { expect, test, type Page } from "@playwright/test";
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(E2E_USER_EMAIL);
  await page.getByLabel("Password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 45_000 });
}

async function expectNoHorizontalOverflow(page: Page, viewportWidth: number) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(dimensions.body, dimensions.document)).toBeLessThanOrEqual(viewportWidth + 1);
}

const mockJob = {
  id: "mock-format-job-123456",
  paperId: "mock-paper-123456",
  status: "needs_confirmation",
  stage: "reading_sources",
  progress: 22,
  paperBrief: {
    profileId: "aqa-gcse-mathematics-8300-1h",
    profileVersion: "2026-test",
    board: "AQA",
    qualification: "GCSE",
    subject: "Mathematics",
    specification: "8300",
    component: "Paper 1 Higher",
    tier: "Higher",
    durationMinutes: 90,
    totalMarks: 80,
    materials: ["Formula sheet"],
    verificationStatus: "limited",
    confidence: "medium",
    requiresConfirmation: true,
    customFallbackAvailable: true,
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "phone", width: 390, height: 844 },
] as const) {
  test(`${viewport.name} exam-format surfaces remain usable`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page);

    await page.route("**/api/practice/paper-jobs/mock-format-job-123456", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockJob) });
    });
    await page.goto("/dashboard/practice/new?job=mock-format-job-123456");
    await expect(page.getByRole("heading", { name: "Check Jami understood the right paper" })).toBeVisible();
    await expectNoHorizontalOverflow(page, viewport.width);
    await page.screenshot({ path: `test-results/exam-format-confirmation-${viewport.name}.png`, fullPage: true });

    await page.route("**/api/internal/exam-formats", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profiles: [] }) });
    });
    await page.route("**/api/internal/paper-quality/runs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          readiness: {
            enabled: true,
            definitionVersion: "2026-08-21.uk-written.v2",
            expectedCases: 108,
            caseCostEstimateUsd: 0.1,
            projectedCostUsd: 10.8,
            missingProfiles: ["all"],
            ready: false,
          },
          runs: [],
        }),
      });
    });
    await page.goto("/dashboard/internal/paper-quality");
    await expect(page.getByRole("heading", { name: "Paper generation, measured properly" })).toBeVisible();
    await expectNoHorizontalOverflow(page, viewport.width);
    await page.screenshot({ path: `test-results/paper-quality-${viewport.name}.png`, fullPage: true });
  });
}
