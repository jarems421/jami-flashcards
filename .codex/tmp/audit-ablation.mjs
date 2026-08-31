/**
 * Why the auditor missed everything: the model, the cap, or the thinking?
 *
 * In production the audit found none of the three swapped schemes and invented
 * five missing-scheme errors, answering in 427 tokens under a 4,000 cap. Given
 * a 16,000 cap and reasoning enabled, the same model found all three. Those are
 * two changes at once, so this varies them one at a time on one model.
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of env.split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { practicePaperFormatContext } = await import("../../lib/practice/exam-formats.ts");
const lib = await import("../../services/ai/exam-format-library.server.ts");

const paper = JSON.parse(readFileSync("final-paper.json", "utf8"));
const profile = await lib.getActiveExamFormatProfileVersion("aqa-a-level-psychology-7182-1");
const SYSTEM = `You are Jami's senior independent assessment supervisor. Check the complete paper and marking guide for factual correctness, answerability, coverage, source alignment, duplicated or ambiguous questions, impossible assets, mark-total errors, choice-rule errors, timing realism, rubric correctness and whether it is genuinely a complete sitting. Do not rewrite the paper. Return JSON only as {"pass":true,"issues":[]} or {"pass":false,"issues":[{"code":"short_code","severity":"warning"|"error","detail":"specific evidence and required correction","questionId":"optional"}]}. Only report substantiated issues.`;
const USER = `--- REQUIRED FORMAT ---\n${practicePaperFormatContext(profile)}\n\n${JSON.stringify(paper)}`;

const SWAPPED = ["q3", "q5", "q6"];
const PRESENT = new Set(paper.markScheme.items.map((i) => i.questionId));
const MISMATCH = /mismatch|different question|unrelated|does not match|not match|wrong question|belongs to|inconsist|irrelevant|not align|no relation/i;
const MISSING = /no mark scheme|missing|not present|no marking guidance|absent|only q1|lacks a mark scheme|contains no/i;

async function run({ cap, thinking, json }) {
  const body = {
    model: "z-ai/glm-5.3-flash",
    provider: { order: ["Morph"], allow_fallbacks: false, data_collection: "deny" },
    temperature: 0,
    max_tokens: cap,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: USER }],
  };
  if (thinking) body.reasoning = { enabled: true, exclude: true, effort: "medium" };
  // What production actually sends: JSON mode forces a parseable answer, which
  // is why its audit returned valid JSON in 427 tokens while these cells
  // rambled to the cap. Valid and shallow is not the same as right.
  if (json) body.response_format = { type: "json_object" };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const choice = payload?.choices?.[0];
  if (!choice) return { cap, thinking, json, error: payload?.error?.message ?? `HTTP ${response.status}` };
  const text = String(choice.message?.content || choice.message?.reasoning || "");
  let parsed = null;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "")); } catch {
    return { cap, thinking, json, error: "unparseable", finish: choice.finish_reason, out: payload.usage?.completion_tokens };
  }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const blob = (i) => `${i.code ?? ""} ${i.detail ?? ""}`;
  const caught = SWAPPED.filter((id) =>
    issues.some((i) => (i.questionId === id || blob(i).includes(id)) && MISMATCH.test(blob(i)))
  );
  const fabricated = issues.filter((i) => {
    if (!MISSING.test(blob(i))) return false;
    const named = [...blob(i).matchAll(/\bq(\d+)\b/gi)].map((m) => `q${m[1]}`);
    return named.length === 0 || named.some((id) => PRESENT.has(id));
  }).length;
  return {
    cap, thinking, json,
    out: payload.usage?.completion_tokens,
    issues: issues.length,
    caught: caught.length,
    fabricated,
  };
}

const grid = [
  { cap: 4000, thinking: false, json: true },   // production exactly
  { cap: 4000, thinking: true, json: true },    // production plus thinking
  { cap: 16000, thinking: true, json: true },   // and more room to answer
];

console.log("cap    think  json   outTok  issues  caught  invented");
for (const cell of grid) {
  const r = await run(cell);
  if (r.error) {
    console.log(`${String(r.cap).padEnd(7)}${String(r.thinking).padEnd(7)}${String(r.json).padEnd(7)}${String(r.out ?? "-").padEnd(8)}${r.error}`);
    continue;
  }
  console.log(
    String(r.cap).padEnd(7) + String(r.thinking).padEnd(7) + String(r.json).padEnd(7) +
    String(r.out).padEnd(8) + String(r.issues).padEnd(8) +
    `${r.caught}/3`.padEnd(8) + String(r.fabricated)
  );
}
