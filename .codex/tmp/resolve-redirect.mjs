import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
process.env.AI_WEB_RESEARCH_ENABLED = "true";
const { generateGroundedResearch } = await import("../../lib/ai/gemini.ts");

const research = await generateGroundedResearch({
  sanitizedQuery: "AQA GCSE Mathematics 8300 Higher Paper 1 question paper past paper pdf filestore",
  timeoutMs: 90_000,
});
if (!research.ok) { console.log("research failed:", research.reason); process.exit(1); }
console.log("citations:", research.citations.length);
for (const c of research.citations.slice(0, 6)) {
  let final = c.url;
  try {
    const r = await fetch(c.url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
    final = r.url;
  } catch (e) { final = "(unresolvable) " + String(e).slice(0, 40); }
  console.log("  raw:  ", c.url.slice(0, 70));
  console.log("  final:", final.slice(0, 110));
}
process.exit(0);
