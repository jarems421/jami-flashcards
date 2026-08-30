import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const svc = await import("../../services/ai/paper-generation-benchmark.server.ts");
const lib = await import("../../services/ai/exam-format-library.server.ts");
const detail = await svc.getPaperGenerationBenchmarkRun(process.argv[2]);
const item = detail?.cases?.[0];
console.log("case profile:", item?.profileId, "@", item?.profileVersion);
const profile = await lib.getExamFormatProfileVersion(item.profileId, item.profileVersion);
console.log("sections:", profile.sections.map((s) => `${s.id} ${s.title}`).join(" | "));
