import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiTokenCap } from "@/lib/ai/budgets";
import { generateAiText } from "@/lib/ai/provider-router";
import { buildMarkerRequest } from "@/services/ai/practice-paper-marking.server";
import { exemplarsToParts } from "@/lib/evaluation/practice-paper-adapter";

/**
 * Why does MiniMax return `{}`?
 *
 * Captured raw output shows every unreadable marking report is a two-byte
 * empty object, always from the supervisor and never from the other two
 * models. 22.7% of its calls. That is not a parsing problem, and the earlier
 * guesses about it — truncation, the evidence rule, unsupported structured
 * output on the endpoint — are all now ruled out: Parasail advertises both
 * `response_format` and `structured_outputs`.
 *
 * What is not yet known is whether a given request reliably produces `{}` or
 * whether the same request sometimes works. That distinction decides the fix
 * entirely: stochastic means retry, deterministic means the request itself.
 *
 * So the same request is replayed several times, and then under variants:
 * without the JSON response format, and against a different endpoint. Nothing
 * production reads is changed; the provider override is set on this process's
 * own environment for the duration of the probe.
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

/** Records seen returning `{}`, and ones that marked cleanly, for contrast. */
const FAILED = ["asap2:AAAOPP13416000046246", "jorgpt:1959", "mohler:6.3.22"];
const CLEAN = ["jorgpt:2756", "mohler:10.7.13", "asap2:AAATRP14318000798522"];

type Variant = { name: string; json: boolean; providers?: string };

const VARIANTS: Variant[] = [
  { name: "current (parasail, json)", json: true },
  { name: "parasail, no json format", json: false },
  { name: "deepinfra, json", json: true, providers: "deepinfra" },
];

/**
 * The identical request production sends, not a reconstruction of one. The
 * first version of this probe rebuilt an approximation and never reproduced
 * the fault, which proved only that the approximation was wrong.
 */
function requestFor(record: MarkingCorpusRecord, exemplars: MarkingCorpusRecord[] = []) {
  const adapted = adaptRecordToPaper(record);
  if (!adapted.ok) return null;
  return buildMarkerRequest({
    paper: adapted.adapted.paper,
    answerParts: adapted.adapted.answerParts,
    exemplarParts: exemplarsToParts(exemplars),
    role: "primary",
    deadlineAt: Date.now() + 90_000,
    maxOutputTokens: getAiTokenCap("practicePaperMarking"),
  });
}

export default async function main(args: string[]) {
  const repeats = Number(args.find((a) => a.startsWith("--repeats="))?.split("=")[1] ?? 4);

  const records: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    records.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  const byId = new Map(records.map((record) => [record.id, record]));
  const chosen = [...FAILED, ...CLEAN]
    .map((id) => byId.get(id))
    .filter((record): record is MarkingCorpusRecord => Boolean(record));

  process.stdout.write(
    `\nReplaying ${chosen.length} requests x ${repeats} repeats x ${VARIANTS.length} variants` +
      ` = ${chosen.length * repeats * VARIANTS.length} calls.\n`
  );
  if (!args.includes("--confirm")) {
    process.stdout.write(`Nothing called. Re-run with --confirm.\n`);
    return;
  }

  mkdirSync(REPORT, { recursive: true });
  const journal = join(REPORT, "minimax-empty-probe.jsonl");
  writeFileSync(journal, "");

  const originalProviders = process.env.OPENROUTER_SUPERVISOR_PROVIDERS;
  const results: {
    record: string;
    variant: string;
    empty: boolean;
    chars: number;
    promptTokens: number;
    endpoint: string;
  }[] = [];

  for (const variant of VARIANTS) {
    // Scoped to this process only; production configuration is untouched.
    if (variant.providers) process.env.OPENROUTER_SUPERVISOR_PROVIDERS = variant.providers;
    else process.env.OPENROUTER_SUPERVISOR_PROVIDERS = originalProviders ?? "parasail";

    process.stdout.write(`\n=== ${variant.name} ===\n`);
    for (const record of chosen) {
      const request = requestFor(record);
      if (!request) continue;
      const outcomes: string[] = [];
      for (let attempt = 0; attempt < repeats; attempt += 1) {
        let endpoint = "?";
        let promptTokens = 0;
        try {
          const text = await generateAiText({
            role: "supervisor",
            taskClass: "important",
            timeoutMs: 90_000,
            deadlineAt: Date.now() + 90_000,
            generationConfig: {
              temperature: 0.05,
              topP: 0.75,
              maxOutputTokens: getAiTokenCap("practicePaperMarking"),
              ...(variant.json ? { responseMimeType: "application/json" } : {}),
            },
            request,
            onResponse: (value) => {
              endpoint = String(
                (value as { providerEndpoint?: string }).providerEndpoint ?? "?"
              );
              promptTokens = Number((value as { promptTokenCount?: number }).promptTokenCount ?? 0);
            },
          });
          const empty = text.trim().replace(/\s/g, "") === "{}";
          outcomes.push(empty ? "{}" : `${text.length}c`);
          const row = { record: record.id, variant: variant.name, empty, chars: text.length, promptTokens, endpoint };
          results.push(row);
          appendFileSync(journal, `${JSON.stringify(row)}\n`);
        } catch (error) {
          outcomes.push("ERR");
          appendFileSync(
            journal,
            `${JSON.stringify({ record: record.id, variant: variant.name, error: String(error).slice(0, 120) })}\n`
          );
        }
      }
      process.stdout.write(`  ${record.id.padEnd(30)} ${outcomes.join("  ")}\n`);
    }
  }
  process.env.OPENROUTER_SUPERVISOR_PROVIDERS = originalProviders;

  process.stdout.write(`\n${"=".repeat(70)}\nEMPTY-RESPONSE RATE BY VARIANT\n${"=".repeat(70)}\n`);
  for (const variant of VARIANTS) {
    const rows = results.filter((row) => row.variant === variant.name);
    if (rows.length === 0) continue;
    const empty = rows.filter((row) => row.empty).length;
    const endpoints = [...new Set(rows.map((row) => row.endpoint))].join(", ");
    process.stdout.write(
      `${variant.name.padEnd(28)} ${String(empty).padStart(3)}/${String(rows.length).padEnd(4)}` +
        ` ${((100 * empty) / rows.length).toFixed(0).padStart(3)}%   via ${endpoints}\n`
    );
  }

  process.stdout.write(`\nPER REQUEST, current variant (is it the request or the luck?)\n`);
  for (const record of chosen) {
    const rows = results.filter((row) => row.record === record.id && row.variant === VARIANTS[0].name);
    if (rows.length === 0) continue;
    const empty = rows.filter((row) => row.empty).length;
    process.stdout.write(
      `  ${record.id.padEnd(30)} ${empty}/${rows.length} empty   prompt ~${rows[0].promptTokens} tokens\n`
    );
  }

  const empties = results.filter((row) => row.empty);
  const fulls = results.filter((row) => !row.empty);
  const mean = (rows: typeof results) =>
    rows.length === 0 ? 0 : Math.round(rows.reduce((s, r) => s + r.promptTokens, 0) / rows.length);
  process.stdout.write(
    `\nprompt tokens: empty ${mean(empties)} (n=${empties.length}) vs full ${mean(fulls)} (n=${fulls.length})\n`
  );
  process.stdout.write(`\nwritten to ${journal}\n`);
}
