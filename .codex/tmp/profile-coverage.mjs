import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const lib = await import("../../services/ai/exam-format-library.server.ts");
const { practicePaperFormatContext } = await import("../../lib/practice/exam-formats.ts");
const profile = await lib.getExamFormatProfileVersion("aqa-a-level-psychology-7182-1", "2026-verified-from-jun22");
const context = practicePaperFormatContext(profile);

// Every leaf value the profile holds, and whether it reaches the prompt.
const leaves = [];
const walk = (node, path) => {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (typeof node === "object") return Object.entries(node).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
  leaves.push({ path, value: node });
};
walk(profile, "");

const skip = /retrievedAt|sourceHash|checksum|createdAt|updatedAt|^id$|profileId|version|status|reviewer|url|citation|evidence/i;
const missing = leaves.filter(({ path, value }) =>
  !skip.test(path) &&
  String(value).length > 0 &&
  !context.includes(String(value))
);
console.log("=== profile values NOT in the designer's context ===");
for (const { path, value } of missing) console.log(`  ${path} = ${JSON.stringify(value)}`.slice(0, 140));
console.log(`\n${missing.length} of ${leaves.length} leaf values unreported.`);
