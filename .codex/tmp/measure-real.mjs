/**
 * Capacity measured with the shape of request that is actually made.
 *
 * A previous probe asked five providers for 400 tokens of "READY", got 8 of 8
 * from four of them, and concluded they had capacity. The real design pass asks
 * for 20,000 tokens of structured JSON, and those same providers accepted it
 * and then died after 94 to 600 seconds. Availability under a toy request says
 * nothing about it.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const key = process.env.OPENROUTER_API_KEY;
const model = process.argv[2];
const providers = process.argv[3].split(",");

const prompt =
  "Design an A-level Psychology exam paper worth 96 marks in four sections of 24 marks each " +
  "(Social influence, Memory, Attachment, Approaches in Psychology). Each section has several " +
  "short questions and one extended question. Return JSON: " +
  '{"questions":[{"id":"q1","section":"A","prompt":"...","marks":4}]}. ' +
  "Include every question with realistic prompts. Return valid JSON only.";

const started = Date.now();
try {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      provider: { order: providers, allow_fallbacks: false },
      max_tokens: 20_000,
      response_format: { type: "json_object" },
      // The supervisor role runs with reasoning enabled, which the earlier
      // probe omitted. Thinking tokens count against the same budget.
      ...(process.env.WITH_REASONING ? { reasoning: { effort: "medium" } } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(420_000),
  });
  const ms = Date.now() - started;
  const body = await res.json().catch(() => null);
  const text = body?.choices?.[0]?.message?.content ?? "";
  const tokens = body?.usage?.completion_tokens ?? 0;
  let questions = -1;
  try { questions = (JSON.parse(text).questions ?? []).length; } catch { /* not json */ }
  console.log(
    providers[0].padEnd(11) + String(res.status).padEnd(6) + (ms / 1000).toFixed(0).padStart(5) + "s" +
    String(tokens).padStart(8) + " tok" +
    (questions >= 0 ? `   ${questions} questions, valid JSON` : `   UNPARSEABLE (${text.length} chars)`) +
    (res.ok ? "" : "   " + String(body?.error?.message ?? "").slice(0, 60))
  );
} catch (error) {
  console.log(providers[0].padEnd(11) + "ERROR " + ((Date.now() - started) / 1000).toFixed(0).padStart(5) + "s   " + String(error).slice(0, 60));
}
