/**
 * What the supervisor endpoint will actually accept, measured rather than guessed.
 *
 * Six consecutive 429s stopped three pilot runs, and the account-level limit
 * OpenRouter reports is unlimited and deprecated, so the refusals are provider
 * capacity that nothing states. Concurrency and backoff have been picked by
 * feel; this is the number they should come from.
 */
import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_SUPERVISOR_MODEL || "minimax/minimax-m3";
const providers = (process.argv[2] || "deepinfra").split(",");

const call = async () => {
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      provider: { order: providers, allow_fallbacks: false },
      max_tokens: 400,
      messages: [{ role: "user", content: "Reply with the single word READY." }],
    }),
  });
  const ms = Date.now() - started;
  const retryAfter = res.headers.get("retry-after") || res.headers.get("x-ratelimit-reset") || "";
  let detail = "";
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    detail = String(body?.error?.message ?? "").slice(0, 70);
  } else {
    await res.json().catch(() => null);
  }
  return { status: res.status, ms, retryAfter, detail };
};

console.log(`model ${model} via ${providers.join(",")}`);
console.log("n   status  ms     retry-after  detail");
let ok = 0, limited = 0;
for (let i = 1; i <= 8; i += 1) {
  const r = await call();
  if (r.status === 200) ok += 1; else if (r.status === 429) limited += 1;
  console.log(
    String(i).padEnd(4) + String(r.status).padEnd(8) + String(r.ms).padEnd(7) +
    String(r.retryAfter || "-").padEnd(13) + r.detail
  );
}
console.log(`\n${ok} of 8 accepted, ${limited} rate-limited, sequential with no gap`);
