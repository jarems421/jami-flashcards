/** Does the reading step find and open real question papers? */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { measurePaperStructure } = await import("../../services/ai/paper-structure.server.ts");
const measured = await measurePaperStructure([
  "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/june/AQA-83001H-QP-JUN22.PDF",
  "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2023/june/AQA-83001H-QP-JUN23.PDF",
  "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/november/AQA-83001H-QP-NOV22.PDF",
], { limit: 3 });
console.log("papers read:", measured.papersRead);
console.log("agreed total:", measured.totalMarks);
console.log("sections:", JSON.stringify(measured.sections));
console.log("parts range:", JSON.stringify(measured.partsRange));
console.log("duration:", measured.durationText, "| calculator:", measured.calculator);
console.log("\nnotes given to the extraction:");
for (const note of measured.notes) console.log("  -", note.slice(0, 130));
process.exit(0);
