/**
 * File each literature question under the set text it is answered on.
 *
 * Reads the question's own wording first and the region of the paper it was
 * cut from second, matches both against the course's checked set-text list,
 * and writes only on an unambiguous match. Calls no model.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/set-text-tagging-run.ts 8702 --dry-run
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/set-text-tagging-run.ts 8702
 */
import process from "node:process";
import { tagExamSetTexts } from "@/services/practice/exam-set-text-tagging.server";

const REASONS: Record<string, string> = {
  ambiguous_or_absent: "names no text, or more than one",
  no_scheme: "no stored scheme to locate its region with",
  regions_unprovable: "its region on the paper could not be proved",
};

export default async function main() {
  const specificationId = process.argv
    .slice(2)
    .find((argument) => !argument.startsWith("--") && !argument.endsWith(".ts"));
  if (!specificationId) {
    console.log("Pass a specification id, e.g. 8702. Add --dry-run to write nothing.");
    return;
  }
  const dryRun = process.argv.includes("--dry-run");

  const result = await tagExamSetTexts({ specificationId, dryRun });
  console.log(
    `\n${specificationId}${dryRun ? " (dry run — nothing written)" : ""}\n\n` +
      `  questions without a text  ${result.scanned}\n` +
      `  would be tagged           ${result.tagged}\n` +
      `  left untagged             ${result.untagged.length}\n`
  );
  if (result.written.length) {
    console.log("Tagged:\n");
    for (const entry of result.written) {
      console.log(
        `  ${entry.label.padEnd(16)} ${entry.setTextLabel?.padEnd(40)} (from its ${entry.source})`
      );
    }
  }
  if (result.untagged.length) {
    console.log("\nLeft untagged — these stay available to every student:\n");
    for (const entry of result.untagged) {
      console.log(`  ${entry.label.padEnd(16)} ${REASONS[entry.reason ?? ""] ?? entry.reason}`);
    }
  }
}
