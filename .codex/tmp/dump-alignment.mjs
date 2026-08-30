/** Run the shipped alignment validator over the published paper. */
import { readFileSync, writeFileSync } from "node:fs";
const { schemeAlignmentIssues } = await import("../../lib/practice/scheme-alignment.ts");

const paper = JSON.parse(readFileSync("final-paper.json", "utf8"));
const byId = new Map(paper.markScheme.items.map((item) => [item.questionId, item]));
const found = {};
for (const question of paper.questions) {
  const issues = schemeAlignmentIssues(question, byId.get(question.id));
  if (issues.length) found[question.id] = issues.map((i) => ({ code: i.code, detail: i.detail }));
}
writeFileSync("align-issues.json", JSON.stringify(found, null, 2));
console.log(JSON.stringify(Object.keys(found)));
