/** Can a paper's AO balance be computed from its schemes? */
import { readFileSync } from "node:fs";
const { normalizeMarkSchemeItem, paperAssessmentObjectiveMarks } =
  await import("../../lib/practice/mark-schemes.ts");
const { canonicalizeGeneratedMarkSchemeItems } =
  await import("../../lib/ai/practice-paper-generation.ts");

const paper = JSON.parse(readFileSync("final-paper.json", "utf8"));
const items = [];
for (const question of paper.questions) {
  const raw = paper.markScheme.items.find((i) => i.questionId === question.id);
  const [canon] = canonicalizeGeneratedMarkSchemeItems([raw]);
  const item = normalizeMarkSchemeItem(canon, question);
  if (item) items.push(item);
}
const totals = paperAssessmentObjectiveMarks(items);
const sum = Object.values(totals).reduce((a, b) => a + b, 0);
console.log("marks by assessment objective:");
for (const [ao, marks] of Object.entries(totals)) {
  console.log(`  ${ao.padEnd(13)} ${String(Math.round(marks * 10) / 10).padStart(5)}  ${(marks / sum * 100).toFixed(0)}%`);
}
console.log(`  ${"total".padEnd(13)} ${String(Math.round(sum)).padStart(5)}`);
