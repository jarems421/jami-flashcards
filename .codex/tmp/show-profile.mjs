import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const svc = await import("../../services/ai/paper-generation-benchmark.server.ts");
const lib = await import("../../services/ai/exam-format-library.server.ts");
const { practicePaperFormatContext } = await import("../../lib/practice/exam-formats.ts");

const runId = "1a005bff-5c42-4ab8-957e-52c1801e0d50";
const detail = await svc.getPaperGenerationBenchmarkRun(runId);
const item = detail?.cases?.[0];
console.log("case:", item?.id, "| profileId:", item?.profileId, "| version:", item?.profileVersion);
const profile = await lib.getExamFormatProfileVersion(item.profileId, item.profileVersion);
if (!profile) { console.log("NO PROFILE for", item.profileId, item.profileVersion); process.exit(1); }
console.log("=== sections as stored ===");
console.log(JSON.stringify(profile.sections, null, 2));
console.log("=== totalMarks:", profile.totalMarks, "| status:", profile.status, "===");
console.log("=== context the designer receives ===");
console.log(practicePaperFormatContext(profile));
