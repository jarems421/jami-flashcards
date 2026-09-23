import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.rules.test.ts"],
    testTimeout: 30_000,
    /*
     * Connecting to a freshly started Firestore emulator regularly takes longer
     * than twenty seconds on a loaded machine, and when it does every rule test
     * is skipped while the run still reports a failure -- which reads as a
     * broken gate rather than a slow one, and is how this suite came to be
     * skipped through a release. The emulator is the slow part, not the rules.
     */
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir),
      "server-only": path.resolve(rootDir, "tests/support/server-only.ts"),
    },
  },
});
