/**
 * Run a TypeScript entry point that imports application code.
 *
 * The corpus scripts load `lib/evaluation/*` straight from source with Node's
 * own type stripping, which works only because those modules import nothing but
 * each other by relative path. Anything reaching into the app proper hits `@/`
 * aliases and `server-only`, which Node cannot resolve.
 *
 * Vite is already a dependency, and its SSR loader resolves exactly what the
 * test runner resolves. So evaluation entry points that need the real marking
 * path are run through here rather than by rewriting the app's imports.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs <entry.ts> [args]
 */
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const [entry, ...args] = process.argv.slice(2);

if (!entry) {
  process.stdout.write("usage: node scripts/run-ts.mjs <entry.ts> [args]\n");
  process.exit(1);
}

const server = await createServer({
  root: rootDir,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true },
  resolve: {
    alias: {
      "@": rootDir,
      // The real package only refuses a browser build; in a script it is inert.
      // Aliasing to the test stub keeps behaviour identical to the test runner.
      "server-only": path.resolve(rootDir, "tests/support/server-only.ts"),
    },
  },
});

try {
  const loaded = await server.ssrLoadModule(path.resolve(rootDir, entry));
  const main = loaded.default ?? loaded.main;
  if (typeof main !== "function") {
    throw new Error(`${entry} exports no default function to run.`);
  }
  await main(args);
} finally {
  await server.close();
}
