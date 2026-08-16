import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiTokenCap } from "@/lib/ai/budgets";
import { generateAiText } from "@/lib/ai/provider-router";
import { buildMarkerRequest } from "@/services/ai/practice-paper-marking.server";

/**
 * Is the empty `{}` response about load, about time, or about nothing?
 *
 * Everything about the request has now been ruled out: exemplar presence,
 * count, content, the previous mark, the framing, and prompt length. What
 * remains is that a sequential probe saw 8% and a concurrent run saw about
 * 25%, and that the earlier "exemplars cause it" reading was confounded with
 * position in the run, because the arms always execute in the same order.
 *
 * So this varies nothing but concurrency, and interleaves it. Batches
 * alternate sequential and concurrent throughout, which is the whole point:
 * running all of one and then all of the other would reproduce exactly the
 * confound it exists to resolve. One request, unchanged, sixty times.
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

/** A record that has marked cleanly before, so content is not in question. */
const RECORD = "jorgpt:2756";
const BATCHES = 10;
const PER_BATCH = 6;
const CONCURRENCY = 3;

type Row = {
  call: number;
  batch: number;
  condition: "sequential" | "concurrent3";
  outcome: "valid" | "empty" | "error";
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  endpoint: string;
};

export default async function main(args: string[]) {
  const all: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    all.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  const record = all.find((entry) => entry.id === RECORD);
  if (!record) throw new Error(`${RECORD} not in the corpus.`);
  const adapted = adaptRecordToPaper(record);
  if (!adapted.ok) throw new Error(adapted.reason);

  const request = buildMarkerRequest({
    paper: adapted.adapted.paper,
    answerParts: adapted.adapted.answerParts,
    role: "primary",
    deadlineAt: Date.now() + 120_000,
    maxOutputTokens: getAiTokenCap("practicePaperMarking"),
  });

  process.stdout.write(
    `\n${BATCHES} batches x ${PER_BATCH} calls = ${BATCHES * PER_BATCH} calls of one unchanged request.\n` +
      `Batches alternate sequential and concurrency-${CONCURRENCY}, so condition and time are independent.\n`
  );
  if (!args.includes("--confirm")) {
    process.stdout.write(`\nNothing called. Re-run with --confirm.\n`);
    return;
  }

  mkdirSync(REPORT, { recursive: true });
  const journal = join(REPORT, "minimax-load-probe.jsonl");
  writeFileSync(journal, "");

  const rows: Row[] = [];
  let call = 0;

  const once = async (batch: number, condition: Row["condition"]): Promise<void> => {
    const index = (call += 1);
    const started = Date.now();
    let promptTokens = 0;
    let outputTokens = 0;
    let endpoint = "?";
    try {
      const generated = await generateAiText({
        role: "supervisor",
        taskClass: "important",
        timeoutMs: 120_000,
        deadlineAt: Date.now() + 120_000,
        generationConfig: {
          temperature: 0.05,
          topP: 0.75,
          maxOutputTokens: getAiTokenCap("practicePaperMarking"),
          responseMimeType: "application/json",
        },
        request,
        onResponse: (value) => {
          const diagnostics = value as {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            providerEndpoint?: string;
          };
          promptTokens = Number(diagnostics.promptTokenCount ?? 0);
          outputTokens = Number(diagnostics.candidatesTokenCount ?? 0);
          endpoint = String(diagnostics.providerEndpoint ?? "?");
        },
      });
      const empty = generated.trim().replace(/\s/g, "") === "{}";
      const row: Row = {
        call: index,
        batch,
        condition,
        outcome: empty ? "empty" : "valid",
        latencyMs: Date.now() - started,
        promptTokens,
        outputTokens,
        endpoint,
      };
      rows.push(row);
      appendFileSync(journal, `${JSON.stringify(row)}\n`);
    } catch {
      const row: Row = {
        call: index,
        batch,
        condition,
        outcome: "error",
        latencyMs: Date.now() - started,
        promptTokens,
        outputTokens,
        endpoint,
      };
      rows.push(row);
      appendFileSync(journal, `${JSON.stringify(row)}\n`);
    }
  };

  for (let batch = 0; batch < BATCHES; batch += 1) {
    const condition: Row["condition"] = batch % 2 === 0 ? "sequential" : "concurrent3";
    process.stdout.write(`batch ${batch} (${condition}) `);
    if (condition === "sequential") {
      for (let index = 0; index < PER_BATCH; index += 1) await once(batch, condition);
    } else {
      for (let wave = 0; wave < PER_BATCH / CONCURRENCY; wave += 1) {
        await Promise.all(
          Array.from({ length: CONCURRENCY }, () => once(batch, condition))
        );
      }
    }
    const batchRows = rows.filter((row) => row.batch === batch);
    process.stdout.write(
      `${batchRows.map((row) => (row.outcome === "valid" ? "." : row.outcome === "empty" ? "{}" : "E")).join("")}\n`
    );
  }

  const rate = (set: Row[]) =>
    set.length === 0 ? "-" : `${((100 * set.filter((row) => row.outcome === "empty").length) / set.length).toFixed(0)}%`;
  const meanLatency = (set: Row[]) =>
    set.length === 0 ? 0 : Math.round(set.reduce((total, row) => total + row.latencyMs, 0) / set.length / 100) / 10;

  process.stdout.write(`\n${"=".repeat(70)}\nLOAD versus TIME\n${"=".repeat(70)}\n`);
  process.stdout.write(`${"condition".padEnd(14)}${"n".padStart(4)}${"empty".padStart(8)}${"mean latency".padStart(14)}\n`);
  for (const condition of ["sequential", "concurrent3"] as const) {
    const set = rows.filter((row) => row.condition === condition);
    process.stdout.write(
      `${condition.padEnd(14)}${String(set.length).padStart(4)}${rate(set).padStart(8)}${(`${meanLatency(set)}s`).padStart(14)}\n`
    );
  }

  process.stdout.write(`\nwithin each condition, by third of the run\n`);
  process.stdout.write(`${"condition".padEnd(14)}${"early".padStart(8)}${"middle".padStart(8)}${"late".padStart(8)}\n`);
  for (const condition of ["sequential", "concurrent3"] as const) {
    const set = rows.filter((row) => row.condition === condition);
    const third = (from: number, to: number) =>
      set.filter((row) => row.batch >= from && row.batch <= to);
    process.stdout.write(
      `${condition.padEnd(14)}${rate(third(0, 2)).padStart(8)}${rate(third(3, 6)).padStart(8)}${rate(third(7, 9)).padStart(8)}\n`
    );
  }

  const empties = rows.filter((row) => row.outcome === "empty");
  process.stdout.write(
    `\noverall ${empties.length} of ${rows.length} empty (${((100 * empties.length) / rows.length).toFixed(1)}%),` +
      ` ${rows.filter((row) => row.outcome === "error").length} errored\n`
  );
  process.stdout.write(`endpoints used: ${[...new Set(rows.map((row) => row.endpoint))].join(", ")}\n`);
  process.stdout.write(`\nwritten to ${journal}\n`);
}
