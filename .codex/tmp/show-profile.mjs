import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const lib = await import("../../services/ai/exam-format-library.server.ts");
const v = await lib.getActiveExamFormatProfileVersion(process.argv[2]);
if (!v) { console.log("no active version"); process.exit(0); }
console.log("totalMarks:", v.totalMarks, "| duration:", v.durationMinutes, "| sections:", (v.sections ?? []).length);
console.log("verificationStatus:", v.verificationStatus, "| confidence:", v.confidence);
console.log("issues:", (v.issues ?? []).map((i) => i.code).join(", ") || "none");
console.log("\nformatSummary:\n ", String(v.formatSummary ?? "").slice(0, 400));
console.log("\ntariffProgression:");
for (const t of v.tariffProgression ?? []) console.log("  -", String(t).slice(0, 130));
console.log("\nchoiceRules:");
for (const c of v.choiceRules ?? []) console.log("  -", String(c).slice(0, 130));
