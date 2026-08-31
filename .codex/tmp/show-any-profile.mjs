import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const lib = await import("../../services/ai/exam-format-library.server.ts");
const { practicePaperFormatContext } = await import("../../lib/practice/exam-formats.ts");
const p = await lib.getActiveExamFormatProfileVersion(process.argv[2]);
if (!p) { console.log("no profile"); process.exit(1); }
console.log(practicePaperFormatContext(p));
console.log("\nconfidence:", p.confidence, "| sections:", p.sections.length, "| tariffProgression:", (p.tariffProgression ?? []).length);
