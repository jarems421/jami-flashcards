import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.PAPER_GENERATION_BENCHMARK_ENABLED = "true";
const svc = await import("../../services/ai/paper-generation-benchmark.server.ts");
const r = await svc.getPaperBenchmarkReadiness();
console.log("ready:", r.ready);
console.log("expectedCases:", r.expectedCases, "| caseCostEstimateUsd:", r.caseCostEstimateUsd, "| projectedCostUsd:", r.projectedCostUsd);
console.log("missingProfiles:", r.missingProfiles.length, r.missingProfiles.slice(0, 12));
process.exit(0);
