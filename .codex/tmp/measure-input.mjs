import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const key = process.env.OPENROUTER_API_KEY;
const [model, provider, kb] = process.argv.slice(2);
// Filler standing in for the source evidence a real design pass carries.
const filler = ("Candidate evidence extract. Psychology specification content on social influence, " +
  "memory, attachment and approaches. ").repeat(Number(kb) * 12);
const prompt = `--- SOURCE EVIDENCE ---\n${filler}\n\n--- TASK ---\n` +
  "Design an A-level Psychology paper worth 96 marks in four 24-mark sections. " +
  'Return JSON: {"questions":[{"id":"q1","section":"A","prompt":"...","marks":4}]}. Valid JSON only.';
const started = Date.now();
try {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, provider: { order: [provider], allow_fallbacks: false },
      max_tokens: 20_000, response_format: { type: "json_object" },
      reasoning: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const ms = Date.now() - started;
  const body = await res.json().catch(() => null);
  const inTok = body?.usage?.prompt_tokens ?? 0;
  const outTok = body?.usage?.completion_tokens ?? 0;
  console.log(`${provider.padEnd(11)}${String(kb).padStart(4)}KB in  ${String(res.status).padEnd(5)}${(ms/1000).toFixed(0).padStart(5)}s  in=${String(inTok).padStart(7)} out=${String(outTok).padStart(6)}  ${res.ok ? "ok" : String(body?.error?.message ?? "").slice(0, 40)}`);
} catch (e) {
  console.log(`${provider.padEnd(11)}${String(kb).padStart(4)}KB in  ERROR ${((Date.now()-started)/1000).toFixed(0).padStart(5)}s  ${String(e).slice(0, 50)}`);
}
