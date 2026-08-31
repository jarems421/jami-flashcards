import { readFileSync, writeFileSync } from "node:fs";
const { schemeAlignmentIssues } = await import("../../lib/practice/scheme-alignment.ts");
const { normalizeMarkSchemeItem } = await import("../../lib/practice/mark-schemes.ts");
const { canonicalizeGeneratedMarkSchemeItems } = await import("../../lib/ai/practice-paper-generation.ts");

const strip = (t) => t.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
const rows = readFileSync(".codex/captures/generation-passes.jsonl", "utf8").trim().split("\n")
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const design = rows.filter((r) => r.pass === "paper_design").at(-1);
const paper = JSON.parse(strip(design.text));
const byId = new Map(paper.questions.map((q) => [q.id, q]));

// Latest scheme item per question, from this run only (after the design).
const cutoff = design.at;
const latest = new Map();
for (const row of rows.filter((r) => r.pass.startsWith("mark_scheme") && r.at > cutoff)) {
  let p = null; try { p = JSON.parse(strip(row.text)); } catch { continue; }
  for (const item of canonicalizeGeneratedMarkSchemeItems(p?.items ?? [])) {
    if (item.questionId) latest.set(String(item.questionId), item);
  }
}

const out = [];
for (const q of paper.questions) {
  const raw = latest.get(q.id);
  if (!raw) continue;
  const item = normalizeMarkSchemeItem(raw, q);
  if (!item) continue;
  const issues = schemeAlignmentIssues(q, item);
  if (!issues.length) continue;
  out.push(`=== ${q.id} [${q.marks}m] ${issues.map((i) => i.code).join(", ")}`);
  out.push(`  Q: ${q.prompt.replace(/\s+/g, " ").slice(0, 200)}`);
  out.push(`  S: ${String(item.answer ?? "").replace(/\s+/g, " ").slice(0, 220)}`);
  for (const i of issues) out.push(`  ! ${i.detail}`);
  out.push("");
}
writeFileSync("inspect-out.txt", out.join("\n") || "no alignment issues");
console.log(out.join("\n") || "no alignment issues");
