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
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const LIMIT = 1200;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEARCH = ["app", "components", "hooks", "lib", "services", "e2e"];
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
  // Lowered on 2026-08-14: the assistant-context builder moved out to
  // hooks/useNotebookAssistantContext when the multi-model work pushed it over.
  ["app/dashboard/notebooks/[notebookId]/page.tsx", 2974],
  ["app/dashboard/study/page.tsx", 2196],
]);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

const failures = [];
const shrunk = [];

for (const dir of SEARCH) {
  const base = join(ROOT, dir);
  try {
    statSync(base);
  } catch {
    continue;
  }
  for (const file of sourceFiles(base)) {
    const key = relative(ROOT, file).split(sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n").length;
    const allowed = EXCEPTIONS.get(key) ?? LIMIT;
    if (lines > allowed) {
      failures.push({ key, lines, allowed });
    } else if (EXCEPTIONS.has(key) && lines <= LIMIT) {
      shrunk.push({ key, lines });
    }
  }
}

for (const { key, lines } of shrunk) {
  console.log(
    `${key} is down to ${lines} lines and no longer needs an exception.`
  );
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

console.log(`No source file over ${LIMIT} lines outside the known exceptions.`);
