/** Which profiles could actually build the paper they describe? */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getAdminDb } = await import("../../services/firebase/admin.ts");
const lib = await import("../../services/ai/exam-format-library.server.ts");
const { markArithmeticIssues } = await import("../../lib/practice/exam-formats.ts");

const snap = await getAdminDb().collection("examFormatProfiles").get();
const rows = [];
for (const doc of snap.docs) {
  const p = await lib.getActiveExamFormatProfileVersion(doc.id).catch(() => null);
  if (!p) { rows.push({ id: doc.id, state: "no active version" }); continue; }
  const issues = markArithmeticIssues(p);
  rows.push({
    id: doc.id,
    confidence: p.confidence,
    sections: p.sections.length,
    tariffs: (p.tariffProgression ?? []).length,
    usable: issues.length === 0,
    why: issues.map((i) => i.code).join(",") || "-",
  });
}
rows.sort((a, b) => Number(a.usable ?? false) - Number(b.usable ?? false));
console.log("usable  conf    sect tariff  profile");
for (const r of rows) {
  console.log(
    `${(r.usable ? "yes" : "NO").padEnd(8)}${String(r.confidence ?? "-").padEnd(8)}` +
    `${String(r.sections ?? "-").padEnd(5)}${String(r.tariffs ?? "-").padEnd(8)}${r.id}`
  );
}
const usable = rows.filter((r) => r.usable).length;
console.log(`\n${usable} of ${rows.length} profiles can build the paper they describe.`);
process.exit(0);
