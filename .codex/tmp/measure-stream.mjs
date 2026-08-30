import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const key = process.env.OPENROUTER_API_KEY;
const [model, provider] = process.argv.slice(2);
const prompt = "Design an A-level Psychology paper worth 96 marks in four 24-mark sections " +
  "(Social influence, Memory, Attachment, Approaches). Every question with a realistic prompt. " +
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
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => null);
    console.log(`${provider.padEnd(11)} stream  ${res.status}  ${String(b?.error?.message ?? "").slice(0, 60)}`);
  } else {
    let chars = 0, chunks = 0, firstByte = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firstByte) firstByte = Date.now() - started;
      chunks += 1; chars += value.length;
    }
    console.log(`${provider.padEnd(11)} stream  200  ${((Date.now()-started)/1000).toFixed(0)}s  first byte ${(firstByte/1000).toFixed(1)}s  ${chunks} chunks  ${chars} bytes`);
  }
} catch (e) {
  console.log(`${provider.padEnd(11)} stream  ERROR after ${((Date.now()-started)/1000).toFixed(0)}s  ${String(e).slice(0, 60)}`);
}
