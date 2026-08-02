import { defineConfig } from "@playwright/test";

const serverEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  )
);

Object.assign(serverEnvironment, {
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-browser-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-jami-browser.firebaseapp.test",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-jami-browser",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-jami-browser.appspot.test",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:notebook-smoke",
  NEXT_PUBLIC_FIREBASE_EMULATORS: "true",
});

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The desktop flow now drives text blocks, ink, autosave, page navigation,
  // reload persistence, and a cross-route return. On a loaded machine that
  // lands near three minutes, so the per-test budget has headroom over it.
  timeout: 300_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // A production build, not `next dev`. The dev server compiles each route on
    // first visit and Fast Refresh can force a full reload mid-run, so a route
    // reached late under load could exceed a 45-60s wait and fail a test that
    // passes in isolation. That produced different failures on every run and
    // made the suite unusable as evidence.
    //
    // Building also means these tests exercise what actually ships, which the
    // production surface matrix was never doing.
    command:
      "npm run build && npx next start --hostname 127.0.0.1 --port 3100",
    env: serverEnvironment,
    reuseExistingServer: false,
    timeout: 420_000,
    url: "http://127.0.0.1:3100/auth",
  },
});
