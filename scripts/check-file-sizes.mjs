#!/usr/bin/env node
/**
 * Fails when a source file grows past the point where it stops being
 * reviewable.
 *
 * The notebook editor page reached 4,525 lines before anyone noticed, and
 * unpicking it took a long run of careful commits. This is the cheap check
 * that would have flagged it years earlier.
 *
 * Existing files over the limit are listed as exceptions rather than being
 * grandfathered silently, so the list is a visible backlog. Do not add to it
 * without a reason; shrink an entry and tighten its number instead.
 *
 * A gate alone only speaks once a file is already too big, and by then a
 * change is waiting behind the split. So it also names every file in the band
 * just under its limit on every run, without failing: that is the moment to
 * move a concern out, while it is still one small commit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const LIMIT = 1200;
/** Past this a file is named on every run, so it is split before it blocks CI. */
const WARN_AT = 1000;
/**
 * Tests carry fixtures and are allowed more room, but not unlimited room: a
 * test file nobody can read stops being a specification.
 */
const TEST_LIMIT = 1500;
const TEST_WARN_AT = 1200;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH = ["app", "components", "hooks", "lib", "services", "workflows", "scripts", "e2e", "tests"];
const SKIP = new Set(["node_modules", ".next", "dist", "build"]);

/**
 * Files already over the limit, with the size they must stay under. Lower a
 * number when a file shrinks; never raise one.
 *
 * Both were raised once, on 2026-08-09, and it is worth saying why rather than
 * leaving two numbers that quietly went up. The notebook page passed 2950
 * during the pinch-zoom and pen-feel work and the study page gained 42 lines
 * when the streak moved to where it is earned. Neither was noticed at the time,
 * so the gate sat red on every push for three days and stopped being read --
 * which is the actual cost, because a gate nobody reads is not a gate.
 *
 * Raising them is a reset, not permission. Splitting either file is the real
 * answer and was deliberately deferred: they are the two largest and most
 * delicate surfaces in the app, and a seam chosen badly in the notebook editor
 * would be far more expensive than the debt it paid off. The ratchet still only
 * turns one way from here.
 */
/*
 * Raised again on 2026-09-04, deliberately and against the rule above.
 *
 * Both files gained the line that tells Tutor settings which folder the current
 * material is in. Without it the settings drawer cannot name the folder whose
 * instructions are in force and has to state the rule instead -- so the choice
 * was a one-line entry in each file, or a feature that silently degrades on the
 * two surfaces students use most.
 *
 * Note what this cost: the notebook page was already 6 lines over its own
 * exception before either change, so that number had stopped being a ratchet
 * and started being a number nobody could satisfy. A gate that is already red
 * cannot stop the next line going in, which is the failure mode the comment
 * above warned about and this is an instance of it. Splitting these two files
 * is the actual fix and is now overdue.
 */
const EXCEPTIONS = new Map([
  // Removed on 2026-10-07: the Tutor route became a composition root over the
  // phases of a turn (1,946 -> 388 lines), and the Tutor drawer over its
  // conversation hooks and parts (1,860 -> 653), once the two Tutor branches
  // they were held for had been merged.
  // Removed on 2026-09-15: practice-paper generation was split into its stages.
  // Removed on 2026-10-06: the notebook page became a composition root over
  // its controller hooks (3,638 -> 1,196 lines), and the study page over its
  // session, exercise and queue hooks (2,431 -> 687 lines).
  // Removed on 2026-10-07: the notebook ink editor became a composition over
  // its editor, pointer-input and snapshot hooks (1,733 -> 315 lines).
]);

const SOURCE = /\.(ts|tsx|mjs|cjs|js)$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (SOURCE.test(entry)) {
      yield relative(ROOT, full).split(sep).join("/");
    }
  }
}

/**
 * What git tracks, so build output and ignored scratch are never counted:
 * the workflow runtime writes a 2,600-line route under `app/` at build time.
 * Falls back to walking the folders where git is not available.
 */
function sourceFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z", "--", ...SEARCH], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((key) => SOURCE.test(key));
  } catch {
    return SEARCH.flatMap((dir) => {
      try {
        return [...walk(join(ROOT, dir))];
      } catch {
        return [];
      }
    });
  }
}

const failures = [];
const shrunk = [];
const nearing = [];

for (const key of sourceFiles()) {
  const isTests = key.startsWith("tests/");
  const limit = isTests ? TEST_LIMIT : LIMIT;
  const warnAt = isTests ? TEST_WARN_AT : WARN_AT;
  const lines = readFileSync(join(ROOT, key), "utf8").split("\n").length;
  const allowed = EXCEPTIONS.get(key) ?? limit;
  if (lines > allowed) {
    failures.push({ key, lines, allowed });
  } else if (EXCEPTIONS.has(key) && lines <= limit) {
    shrunk.push({ key, lines });
  } else if (lines > warnAt) {
    nearing.push({ key, lines, allowed });
  }
}

for (const { key, lines } of shrunk) {
  console.log(
    `${key} is down to ${lines} lines and no longer needs an exception.`
  );
}

if (nearing.length > 0) {
  console.warn("\nClose to the size limit -- move a concern out before adding to these:\n");
  for (const { key, lines, allowed } of nearing.sort((left, right) => right.lines - left.lines)) {
    console.warn(`  ${key}: ${lines} lines (limit ${allowed})`);
  }
  console.warn("");
}

if (failures.length > 0) {
  console.error("\nFiles past their size limit:\n");
  for (const { key, lines, allowed } of failures) {
    console.error(`  ${key}: ${lines} lines (limit ${allowed})`);
  }
  console.error(
    `\nSplit the file, or if it is already listed as an exception, do not raise` +
      ` its number.\n`
  );
  process.exit(1);
}

console.log(`No file past its size limit (${LIMIT} lines, ${TEST_LIMIT} for tests).`);
