import { defineConfig } from "@playwright/test";

/*
 * Jami Ink's renderer specs (docs/notebook-ink.md, stage 3). They draw on a
 * blank page with the harness bundled in (e2e/ink-engine/bundle.ts), so there
 * is no web server, no build and no emulator:
 *
 *   npx playwright test -c playwright.ink.config.ts                fidelity and lift
 *   INK_PERF=1 npx playwright test -c playwright.ink.config.ts     plus the render gates
 *
 * The spec files end in `.ink.ts`, which the app's own Playwright config and
 * Vitest never pick up.
 */

const GPU = process.env.INK_MODE === "gpu";

export default defineConfig({
  testDir: "./e2e/ink-engine",
  testMatch: /\.ink\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    ...(GPU ? { headless: false, launchOptions: { args: ["--ignore-gpu-blocklist"] } } : {}),
  },
});
