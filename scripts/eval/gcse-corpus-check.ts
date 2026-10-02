import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { parseBandsFromScheme } from "@/lib/evaluation/mark-scheme-bands";

/**
 * What the marker would be given for every GCSE board record, before paying
 * for it: refusals, and schemes the adapter could only estimate. Free.
 *
 *   node scripts/run-ts.mjs scripts/eval/gcse-corpus-check.ts
 */
export default async function main() {
  const { records } = JSON.parse(
    readFileSync(resolve("artifacts/corpus/gcse-board-exemplars.json"), "utf8")
  ) as { records: MarkingCorpusRecord[] };
  const tally = new Map<string, number>();
  const refused: string[] = [];
  for (const record of records) {
    // A stand-in image: this checks the paper, not the pixels.
    const image = [{ inlineData: { mimeType: "image/png", data: "" } }];
    const result = adaptRecordToPaper(record, { answerImages: image, questionImages: record.questionImages ? image : [] });
    const key = `${record.board} ${record.subject} ${record.regime}`;
    if (!result.ok) {
      refused.push(`${record.id}: ${result.reason}`);
      tally.set(`${key} REFUSED`, (tally.get(`${key} REFUSED`) ?? 0) + 1);
      continue;
    }
    // Levels-marked: did the board's own bands parse, or would the marker be handed estimated ones?
    const kind =
      record.regime === "banded"
        ? parseBandsFromScheme(record.markScheme ?? "", record.maxMarks).length > 0
          ? "board bands"
          : "ESTIMATED bands"
        : result.adapted.schemeRepresentation;
    tally.set(`${key} ${kind}`, (tally.get(`${key} ${kind}`) ?? 0) + 1);
  }
  for (const [key, count] of [...tally.entries()].sort()) process.stdout.write(`${String(count).padStart(4)}  ${key}\n`);
  for (const line of refused.slice(0, 20)) process.stdout.write(`  refused ${line}\n`);
}
