import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const lib = await import("../../services/ai/exam-format-library.server.ts");
const profiles = await lib.listExamFormatProfiles(200);
console.log(`stored profiles: ${profiles.length}`);
for (const p of profiles) {
  const version = await lib.getActiveExamFormatProfileVersion(p.id).catch(() => null);
  if (!version) { console.log(`  ${p.id.padEnd(46)} no active version`); continue; }
  const secs = version.sections ?? [];
  const stated = secs.map((s) => s.marks).filter((m) => typeof m === "number" && m > 0);
  const summed = stated.reduce((t, m) => t + m, 0);
  const complete = stated.length === secs.length && secs.length > 0;
  const verdict = !complete
    ? `sections do not all state marks (${stated.length}/${secs.length})`
    : summed === version.totalMarks
      ? `OK  ${summed} = ${version.totalMarks}`
      : `MISMATCH  sections ${summed} vs total ${version.totalMarks}`;
  console.log(`  ${p.id.padEnd(46)} ${String(version.totalMarks).padStart(4)}  ${verdict}`);
  const flagged = (version.issues ?? []).filter((i) => i.code === "conflicting_marks");
  for (const i of flagged) console.log(`      flagged: ${i.message.slice(0, 90)}`);
}
