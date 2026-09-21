#!/usr/bin/env node
/**
 * Is there enough room to trust the next run?
 *
 * A build or a test suite that runs out of disk does not say so. `next build`
 * reports a webpack error; vitest reports fewer test files than exist and an
 * "Errors" count with no detail, and still exits 0. Both look like a code
 * regression, and both have cost real time on this machine being investigated
 * as one.
 *
 * So this runs first and says which it is. It is deliberately cheap -- one
 * statfs call and a handful of directory walks -- so it can sit in front of
 * the slow commands without being felt.
 *
 *   node scripts/check-disk.mjs          report and warn
 *   node scripts/check-disk.mjs --strict exit 1 when below the floor
 *   node scripts/check-disk.mjs --clean  remove regenerable build output first
 */
import { statfsSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What a full build plus a full test run actually needs here.
 *
 * `next build` alone wrote about 1.1 GB of `.next` before the last failure, and
 * vitest's transform cache grows with it. Three gigabytes is that with room to
 * be wrong.
 */
const FLOOR_GB = 3;

/** Only ever these: everything here is rebuilt by a command in package.json. */
const REGENERABLE = [
  { path: ".next", rebuiltBy: "npm run build" },
  { path: "coverage", rebuiltBy: "vitest run --coverage" },
  { path: "playwright-report", rebuiltBy: "npm run test:e2e" },
  { path: "test-results", rebuiltBy: "npm run test:e2e" },
  { path: ".firebase", rebuiltBy: "firebase emulators" },
];

function directorySize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      // Never follow a junction: a worktree's node_modules is a link to this
      // one, and counting through it reports the same gigabyte four times.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          // A file that vanished mid-walk is not an error worth reporting.
        }
      }
    }
  }
  return total;
}

function freeGb() {
  const stats = statfsSync(ROOT);
  return (stats.bavail * stats.bsize) / 1024 ** 3;
}

const gb = (bytes) => (bytes / 1024 ** 3).toFixed(2);

const clean = process.argv.includes("--clean");
const strict = process.argv.includes("--strict");

const before = freeGb();
console.log(`Free on this volume: ${before.toFixed(2)} GB`);

let reclaimable = 0;
for (const entry of REGENERABLE) {
  const full = join(ROOT, entry.path);
  if (!existsSync(full)) continue;
  const size = directorySize(full);
  reclaimable += size;
  console.log(`  ${entry.path.padEnd(20)} ${gb(size).padStart(7)} GB   rebuilt by: ${entry.rebuiltBy}`);
  if (clean) {
    rmSync(full, { recursive: true, force: true });
  }
}

if (reclaimable === 0) {
  console.log("  (no regenerable build output present)");
} else if (clean) {
  console.log(`\nRemoved ${gb(reclaimable)} GB. Free now: ${freeGb().toFixed(2)} GB`);
}

const free = freeGb();
if (free < FLOOR_GB) {
  console.error(
    `\nBelow ${FLOOR_GB} GB free.\n` +
      `A build or test run from here may fail for want of space rather than for a fault\n` +
      `in the code: webpack reports an ordinary error, and vitest silently runs fewer\n` +
      `test files than exist while still exiting 0. Treat any failure now as suspect\n` +
      `until this is cleared.`
  );
  if (strict) process.exit(1);
} else {
  console.log(`\nEnough room (floor is ${FLOOR_GB} GB).`);
}
