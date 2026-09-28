/**
 * Is a cheaper model as good at grounded research as the one in use?
 *
 *   npm run eval:research-models [-- --models gemini-3.5-flash-lite,gemini-2.5-flash-lite]
 *
 * Research writes the evidence brief a practice paper is designed from, and
 * the web evidence the Tutor answers with when a student's own sources run
 * out. Moving it to a cheaper model is only a saving if the briefs stay as
 * good, so this runs the real research call -- the same prompt, tools and
 * limits -- on every model for the same queries and records, per brief:
 * latency, length, how many citations, how many from official exam-board,
 * government or university domains, searches, and cost.
 *
 * The numbers only screen. The briefs themselves are written to
 * artifacts/evaluation/research-model-compare.json to be read side by side,
 * because a brief can be long, well cited and wrong.
 *
 * Queries come from the app's own builders run over invented requests, so no
 * student's words go anywhere. Nothing is stored except the report.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateGroundedResearch } from "@/lib/ai/gemini";
import { sanitizeTutorResearchQuery } from "@/lib/ai/jami-assistant";
import { buildPracticePaperResearchQuery } from "@/lib/ai/practice-paper-generation";
import { estimateCallCostUsd, readModelPrices, type AiSpendSample } from "@/lib/ai/spend";
import { runWithAiSpendContext } from "@/lib/ai/spend-context";

const PAPER_REQUESTS = [
  { subject: "Biology", studyLevel: "GCSE", request: "AQA GCSE Biology paper 1 higher tier" },
  { subject: "Mathematics", studyLevel: "A-level", request: "Pearson Edexcel A level maths pure paper 9MA0" },
  { subject: "Chemistry", studyLevel: "A-level", request: "OCR A level chemistry paper 2" },
  { subject: "English Literature", studyLevel: "GCSE", request: "AQA GCSE English literature paper 1 Macbeth" },
  { subject: "History", studyLevel: "GCSE", request: "WJEC Eduqas GCSE history component 1" },
  { subject: "Psychology", studyLevel: "A-level", request: "AQA A level psychology paper 1" },
  { subject: "Computer Science", studyLevel: "GCSE", request: "OCR GCSE computer science J277 paper 2" },
  { subject: "Economics", studyLevel: "university", request: "first year microeconomics exam" },
];

const TUTOR_QUESTIONS = [
  "What is the latest AQA GCSE biology specification for required practicals?",
  "Can you look up how many marks the OCR A level physics paper 1 is worth?",
  "Verify the current Edexcel GCSE maths formula sheet requirements",
  "Search the web for the AQA A level psychology research methods specification",
  "What does the latest WJEC GCSE geography fieldwork requirement say?",
  "Look up the current CCEA GCSE chemistry unit structure",
];

const OFFICIAL = /\b(aqa\.org\.uk|ocr\.org\.uk|pearson\.com|qualifications\.pearson|wjec\.co\.uk|eduqas\.co\.uk|ccea\.org\.uk|sqa\.org\.uk|cambridgeinternational\.org|ibo\.org|gov\.uk|ofqual|\.ac\.uk|\.edu)\b/i;

function readArg(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

type Row = {
  kind: "paper" | "tutor";
  query: string;
  model: string;
  ok: boolean;
  reason?: string;
  ms: number;
  words: number;
  citations: number;
  official: number;
  searches: number;
  costUsd: number | null;
  brief: string;
  citationTitles: string[];
};

async function research(kind: Row["kind"], query: string, model: string): Promise<Row> {
  process.env.GEMINI_RESEARCH_MODEL = model;
  const samples: AiSpendSample[] = [];
  const started = Date.now();
  const result = await runWithAiSpendContext(
    { uid: "eval", action: "research-compare", record: (sample) => samples.push(sample) },
    () => generateGroundedResearch({ sanitizedQuery: query, timeoutMs: 60_000 })
  );
  const ms = Date.now() - started;
  const prices = readModelPrices(process.env);
  const costs = samples.map((sample) => estimateCallCostUsd(sample, prices));
  const costUsd = costs.some((cost) => cost === null) ? null : costs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const searches = samples.reduce((total, sample) => total + (sample.searches ?? 0), 0);
  if (!result.ok) {
    return { kind, query, model, ok: false, reason: result.reason, ms, words: 0, citations: 0, official: 0, searches, costUsd, brief: "", citationTitles: [] };
  }
  const citationTitles = result.citations.map((citation) => citation.title);
  return {
    kind,
    query,
    model,
    ok: true,
    ms,
    words: result.brief.split(/\s+/).filter(Boolean).length,
    citations: result.citations.length,
    official: result.citations.filter((citation) => OFFICIAL.test(`${citation.title} ${citation.url}`)).length,
    searches,
    costUsd,
    brief: result.brief,
    citationTitles,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export default async function main(args: readonly string[] = process.argv.slice(2)) {
  const models = (readArg(args, "--models") ?? "gemini-3.5-flash-lite,gemini-2.5-flash-lite")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (process.env.AI_WEB_RESEARCH_ENABLED !== "true") {
    console.log("AI_WEB_RESEARCH_ENABLED is not true; research would not run.");
    process.exit(1);
  }

  const queries: { kind: Row["kind"]; query: string }[] = [
    ...PAPER_REQUESTS.map((request) => ({ kind: "paper" as const, query: buildPracticePaperResearchQuery(request) })),
    ...TUTOR_QUESTIONS.flatMap((message) => {
      const query = sanitizeTutorResearchQuery(message);
      return query ? [{ kind: "tutor" as const, query }] : [];
    }),
  ];

  const rows: Row[] = [];
  for (const { kind, query } of queries) {
    // Models alternate per query, so neither always goes first into a warm cache.
    const order = rows.length % 2 === 0 ? models : [...models].reverse();
    for (const model of order) {
      const row = await research(kind, query, model);
      rows.push(row);
      console.log(
        `${model.padEnd(24)} ${kind.padEnd(5)} ${row.ok ? "ok  " : `FAIL ${row.reason}`} ` +
          `${String(row.ms).padStart(6)}ms ${String(row.words).padStart(4)}w ` +
          `cites ${row.citations} (official ${row.official}) searches ${row.searches} ` +
          `${row.costUsd === null ? "unpriced" : `$${row.costUsd.toFixed(4)}`}  ${query.slice(0, 60)}`
      );
    }
  }

  console.log("\nPer model");
  for (const model of models) {
    const own = rows.filter((row) => row.model === model);
    const ok = own.filter((row) => row.ok);
    const priced = own.filter((row) => row.costUsd !== null);
    console.log(
      `${model.padEnd(24)} ok ${ok.length}/${own.length}  median ${median(own.map((row) => row.ms))}ms  ` +
        `median ${median(ok.map((row) => row.words))} words  citations/brief ${(ok.reduce((t, r) => t + r.citations, 0) / Math.max(1, ok.length)).toFixed(1)}  ` +
        `official/brief ${(ok.reduce((t, r) => t + r.official, 0) / Math.max(1, ok.length)).toFixed(1)}  ` +
        `mean cost ${priced.length ? `$${(priced.reduce((t, r) => t + (r.costUsd ?? 0), 0) / priced.length).toFixed(4)}` : "unpriced"}`
    );
  }

  const outDir = path.join(process.cwd(), "artifacts", "evaluation");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "research-model-compare.json");
  writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), models, rows }, null, 2));
  console.log(`\nBriefs written to ${outPath}`);
  if (rows.every((row) => !row.ok)) {
    // Research reports every provider error as "unavailable", so say where to look.
    console.log(
      "\nEvery call failed. Research hides the provider's error; the usual causes are the " +
        "project's monthly spend cap (ai.studio/spend) or a closed Gemini release gate."
    );
    process.exitCode = 1;
  }
}
