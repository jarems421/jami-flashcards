import { readFileSync } from "node:fs";

const REVIEWER_UID = "PPm4x6PcMMQiZlmEKJ8rHCeVMm63";
const SPEND_CEILING_USD = 2.4;
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}

Object.assign(process.env, {
  PAPER_GENERATION_BENCHMARK_ENABLED: "true",
  PAPER_BENCHMARK_PILOT_CASE_COST_ESTIMATE_USD: "0.20",
  OPENROUTER_WORKER_PROVIDERS: "parasail",
  OPENROUTER_WORKER_FAILOVER_PROVIDERS: "novita",
  // MiniMax M3 has exactly one endpoint meeting the ZDR, full-context, fp8 and
  // structured-output bar, and that endpoint refuses every M3 request while
  // serving other models on the same account at 8 of 8. One compliant provider
  // is a single point of failure, and it failed.
  //
  // Scanning every ZDR endpoint for models clearing the same bar found four,
  // and only one of them has more than a single provider: z-ai/glm-5.3-flash,
  // compliant on Modal, Parasail, Morph, Phala and DeepInfra. Measured 8 of 8
  // on four of those and 6 of 8 on the fifth. It is also larger context
  // (1,310,720 against 1,048,576) and about a quarter of the price.
  //
  // Pilot only. Production routing is unchanged until this is shown to mark
  // and design as well as M3 does.
  OPENROUTER_SUPERVISOR_MODEL: "z-ai/glm-5.3-flash",
  OPENROUTER_SUPERVISOR_PROVIDERS: "modal",
  OPENROUTER_SUPERVISOR_STANDBY_MODEL: "z-ai/glm-5.3-flash",
  OPENROUTER_SUPERVISOR_STANDBY_PROVIDERS: "morph",
  PRACTICE_PAPER_MODEL_TIMEOUT_MS: "600000",
  PRACTICE_PAPER_DURABLE_DEADLINE_MS: "2400000",
  PRACTICE_PAPER_MARK_SCHEME_WORKER_ENABLED: "true",
});

const service = await import("../../services/ai/paper-generation-benchmark.server.ts");
if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ imported: true, callable: typeof service.runPaperGenerationBenchmarkCase === "function" }));
  process.exit(0);
}

const statusRunIdIndex = process.argv.indexOf("--status");
if (statusRunIdIndex >= 0) {
  const statusRunId = process.argv[statusRunIdIndex + 1];
  const detail = await service.getPaperGenerationBenchmarkRun(statusRunId);
  console.log(JSON.stringify({
    run: detail?.run,
    cases: detail?.cases.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      failureCode: item.failureCode,
      costUsd: item.costUsd,
    })),
  }));
  process.exit(0);
}

async function remainingCredit() {
  const response = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  const payload = await response.json().catch(() => null);
  const remaining = Number(payload?.data?.total_credits) - Number(payload?.data?.total_usage);
  if (!response.ok || !Number.isFinite(remaining)) throw new Error("Could not verify provider balance.");
  return remaining;
}

const runIdIndex = process.argv.indexOf("--run-id");
const requestedRunId = runIdIndex >= 0 ? process.argv[runIdIndex + 1] : undefined;
const maxCasesIndex = process.argv.indexOf("--max-cases");
const maxCases = maxCasesIndex >= 0
  ? Math.max(1, Number.parseInt(process.argv[maxCasesIndex + 1] ?? "1", 10) || 1)
  : Number.POSITIVE_INFINITY;
let run;
if (requestedRunId) {
  const existing = await service.getPaperGenerationBenchmarkRun(requestedRunId);
  if (!existing) throw new Error("Requested pilot run does not exist.");
  await service.resumePaperGenerationBenchmarkRun(requestedRunId, SPEND_CEILING_USD);
  run = existing.run;
  console.log(JSON.stringify({ event: "pilot_resumed", runId: run.id, expectedCases: run.expectedCases }));
} else {
  run = await service.createPaperGenerationBenchmarkRun({
    reviewerUid: REVIEWER_UID,
    spendCeilingUsd: SPEND_CEILING_USD,
    kind: "pilot",
  });
  console.log(JSON.stringify({ event: "pilot_created", runId: run.id, expectedCases: run.expectedCases }));
}

const caseIds = await service.listPaperGenerationBenchmarkCaseIds(run.id);
let attempted = 0;
for (let index = 0; index < caseIds.length; index += 1) {
  const balance = await remainingCredit();
  if (balance < 0.25) {
    await service.cancelPaperGenerationBenchmarkRun(run.id);
    console.log(JSON.stringify({ event: "balance_guard", remainingCredit: balance, casesAttempted: index }));
    break;
  }
  const caseId = caseIds[index];
  const current = await service.getPaperGenerationBenchmarkRun(run.id);
  const currentCase = current?.cases.find((item) => item.id === caseId);
  if (currentCase?.status === "ready") continue;
  if (attempted >= maxCases) break;
  attempted += 1;
  console.log(JSON.stringify({ event: "case_started", caseId, position: index + 1, total: caseIds.length, remainingCredit: balance }));
  const status = await service.runPaperGenerationBenchmarkCase(run.id, caseId);
  console.log(JSON.stringify({ event: "case_finished", caseId, status }));
  if (status === "cancelled" || status === "paused") break;
}
await service.finishPaperGenerationBenchmarkRun(run.id);
const detail = await service.getPaperGenerationBenchmarkRun(run.id);
console.log(JSON.stringify({
  event: "pilot_finished",
  runId: run.id,
  status: detail?.run.status,
  completedCases: detail?.run.completedCases,
  expectedCases: detail?.run.expectedCases,
  estimatedCostUsd: detail?.run.estimatedCostUsd,
  failures: detail?.cases.filter((item) => item.status === "failed").map((item) => ({ id: item.id, code: item.failureCode })),
}));
