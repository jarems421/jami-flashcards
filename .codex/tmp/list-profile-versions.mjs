import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getAdminDb } = await import("../../services/firebase/admin.ts");
const lib = await import("../../services/ai/exam-format-library.server.ts");

const snap = await getAdminDb()
  .collection("examFormatProfiles").doc("aqa-a-level-psychology-7182-1")
  .collection("versions").get();
for (const doc of snap.docs) {
  const v = doc.data();
  const d = (v.sections ?? []).find((s) => s.id === "D");
  console.log(
    doc.id,
    "| status:", v.status,
    "| effectiveFrom:", v.effectiveFrom,
    "| retrievedAt:", v.retrievedAt,
    "| D:", d?.title
  );
}
const active = await lib.getActiveExamFormatProfileVersion("aqa-a-level-psychology-7182-1");
console.log("\nactive selects:", active?.version, "| D:", active?.sections.find((s) => s.id === "D")?.title);
