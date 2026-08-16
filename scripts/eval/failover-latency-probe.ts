import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiTokenCap } from "@/lib/ai/budgets";
import { generateAiText } from "@/lib/ai/provider-router";
import { buildMarkerRequest } from "@/services/ai/practice-paper-marking.server";

/**
 * How long does the failover endpoint actually take?
 *
 * The failover was added without measuring this, which was the mistake: the
 * supervisor's 60-second budget was measured against Parasail, where p90 is
 * about ten seconds, and DeepInfra inherited it. In the slice run 132 of 798
 * supervisor calls hit that wall, each burning a minute for nothing, and a
 * three-hour run became a nineteen-hour one.
 *
 * A published median latency does not describe this workload — four thousand
 * token marking prompts with reasoning enabled — so it gets measured on the
 * real request with a ceiling generous enough not to censor the answer.
 */

const CORPUS = resolve("artifacts/corpus");
const CEILING_MS = 300_000;

export default async function main(args: string[]) {
  const count = Number(args.find((a) => a.startsWith("--count="))?.split("=")[1] ?? 15);
  const providers = (args.find((a) => a.startsWith("--providers="))?.split("=")[1] ?? "deepinfra")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const all: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    all.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  // A spread of sizes, since latency tracks the work not the average request.
  const chosen = ["mohler:6.3.22", "jorgpt:2756", "asap2:AAATRP14318000798522"]
    .map((id) => all.find((record) => record.id === id))
    .filter((record): record is MarkingCorpusRecord => Boolean(record));

  process.stdout.write(
    `\nProbing [${providers.join(", ")}] with a ${CEILING_MS / 1000}s ceiling, ${count} calls over ${chosen.length} requests.\n`
  );
  if (!args.includes("--confirm")) {
    process.stdout.write(`Nothing called. Re-run with --confirm.\n`);
    return;
  }

  const latencies: number[] = [];
  let failures = 0;
  let empties = 0;

  for (let index = 0; index < count; index += 1) {
    const record = chosen[index % chosen.length];
    const adapted = adaptRecordToPaper(record);
    if (!adapted.ok) continue;
    const request = buildMarkerRequest({
      paper: adapted.adapted.paper,
      answerParts: adapted.adapted.answerParts,
      role: "primary",
      deadlineAt: Date.now() + CEILING_MS,
      maxOutputTokens: getAiTokenCap("practicePaperMarking"),
    });

    const started = Date.now();
    try {
      const generated = await generateAiText({
        role: "supervisor",
        taskClass: "important",
        providerOverride: providers,
        timeoutMs: CEILING_MS,
        deadlineAt: Date.now() + CEILING_MS,
        generationConfig: {
          temperature: 0.05,
          topP: 0.75,
          maxOutputTokens: getAiTokenCap("practicePaperMarking"),
          responseMimeType: "application/json",
        },
        request,
      });
      const elapsed = Date.now() - started;
      latencies.push(elapsed);
      const empty = generated.trim().replace(/\s/g, "") === "{}";
      if (empty) empties += 1;
      process.stdout.write(
        `  ${String(index + 1).padStart(3)}  ${(elapsed / 1000).toFixed(1).padStart(6)}s  ${
          empty ? "{}" : `${generated.length} chars`
        }\n`
      );
    } catch (error) {
      failures += 1;
      process.stdout.write(
        `  ${String(index + 1).padStart(3)}  ${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  FAILED ${
          error instanceof Error ? error.message.slice(0, 60) : ""
        }\n`
      );
    }
  }

  if (latencies.length === 0) {
    process.stdout.write(`\nNo successful calls. This endpoint cannot serve the workload.\n`);
    return;
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  process.stdout.write(
    `\nn=${sorted.length}  failed=${failures}  empty=${empties}\n` +
      `  min ${(sorted[0] / 1000).toFixed(1)}s\n` +
      `  p50 ${(at(0.5) / 1000).toFixed(1)}s\n` +
      `  p90 ${(at(0.9) / 1000).toFixed(1)}s\n` +
      `  max ${(sorted[sorted.length - 1] / 1000).toFixed(1)}s\n` +
      `  over the current 60s supervisor budget: ${sorted.filter((ms) => ms > 60_000).length} of ${sorted.length}\n`
  );
}
