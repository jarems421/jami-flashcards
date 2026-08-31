/**
 * Which model can audit a paper, measured against a paper we know the truth about.
 *
 * The published paper is ground truth twice over. It contains three schemes
 * belonging to a different paper -- q3, q5 and q6, each confirmed by reading
 * the question against its scheme -- which the auditor in production missed
 * entirely. And it contains a complete eighteen-item marking guide, which that
 * same auditor reported as "only q1 is present", inventing five MARK_TOTAL
 * errors on a paper whose schemes were all there.
 *
 * So an auditor can be scored on this paper without a human in the loop: does
 * it find the three wrong schemes, and does it claim the marking guide is
 * missing? Both are checkable from the text.
 *
 * This replays one captured paper. It says nothing about how a model designs a
 * paper or writes a scheme, and nothing about subject accuracy. It measures one
 * seat.
 */
import { readFileSync, writeFileSync } from "node:fs";

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
const formatContext = practicePaperFormatContext(profile);

// The instruction the pipeline actually sends.
const SYSTEM = `You are Jami's senior independent assessment supervisor. Check the complete paper and marking guide for factual correctness, answerability, coverage, source alignment, duplicated or ambiguous questions, impossible assets, mark-total errors, choice-rule errors, timing realism, rubric correctness and whether it is genuinely a complete sitting. Do not rewrite the paper. Return JSON only as {"pass":true,"issues":[]} or {"pass":false,"issues":[{"code":"short_code","severity":"warning"|"error","detail":"specific evidence and required correction","questionId":"optional"}]}. Only report substantiated issues.`;
const USER = `--- REQUIRED FORMAT ---\n${formatContext}\n\n${JSON.stringify(paper)}`;

const CANDIDATES = [
  { model: "z-ai/glm-5.3-flash", providers: ["Morph"] },
  { model: "minimax/minimax-m3", providers: ["Parasail"] },
  { model: "moonshotai/kimi-k3", providers: ["DeepInfra"] },
  { model: "xiaomi/mimo-v2.5", providers: ["Parasail"] },
];

/** Questions whose scheme belongs to another paper, read and confirmed. */
const SWAPPED = ["q3", "q5", "q6"];
/** Every question has a scheme item; a claim otherwise is invented. */
const PRESENT = new Set(paper.markScheme.items.map((i) => i.questionId));

const MISMATCH = /mismatch|different question|unrelated|does not match|not match|wrong question|belongs to|inconsist|irrelevant|not align|no relation/i;
const MISSING = /no mark scheme|missing|not present|no marking guidance|absent|only q1|lacks a mark scheme|contains no/i;

async function audit(candidate) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: candidate.model,
      provider: { order: candidate.providers, allow_fallbacks: false, data_collection: "deny" },
      temperature: 0,
      // The production audit caps at 4,000 and its own model answered in 427.
      // Three of the four candidates ran past it and came back truncated
      // mid-string, which is a cap being measured, not a model failing.
      max_tokens: 16000,
      reasoning: { enabled: true, exclude: true, effort: "medium" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.choices?.[0]) {
    return { model: candidate.model, error: payload?.error?.message ?? `HTTP ${response.status}` };
  }
  const message = payload.choices[0].message ?? {};
  // Some of these answer in reasoning and leave content empty.
  const text = String(message.content || message.reasoning || "");
  if (!text.trim()) {
    return { model: candidate.model, error: "empty response", finish: payload.choices[0].finish_reason };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
  } catch {
    return {
      model: candidate.model,
      error: "unparseable JSON",
      finish: payload.choices[0].finish_reason,
      raw: text.slice(-300),
    };
  }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const blob = (issue) => `${issue.code ?? ""} ${issue.detail ?? ""}`;

  const caught = SWAPPED.filter((id) =>
    issues.some((issue) => {
      const text = blob(issue);
      return (issue.questionId === id || text.includes(id)) && MISMATCH.test(text);
    })
  );
  const fabricated = issues.filter((issue) => {
    const text = blob(issue);
    if (!MISSING.test(text)) return false;
    // Only counts as invented if it names a question that does have a scheme.
    const named = [...text.matchAll(/\bq(\d+)\b/gi)].map((m) => `q${m[1]}`);
    return named.length === 0 ? true : named.some((id) => PRESENT.has(id));
  });

  return {
    model: candidate.model,
    seconds: Math.round((Date.now() - started) / 1000),
    costUsd: payload.usage?.cost ?? null,
    pass: parsed?.pass,
    issues: issues.length,
    caught,
    missed: SWAPPED.filter((id) => !caught.includes(id)),
    fabricated: fabricated.length,
    sample: issues.slice(0, 3).map((i) => `${i.code}: ${String(i.detail ?? "").slice(0, 110)}`),
  };
}

const results = [];
for (const candidate of CANDIDATES) {
  process.stdout.write(`auditing with ${candidate.model} ... `);
  try {
    const result = await audit(candidate);
    results.push(result);
    console.log(result.error ? `failed: ${result.error}` : `${result.caught.length}/3 caught, ${result.fabricated} invented`);
  } catch (error) {
    results.push({ model: candidate.model, error: String(error).slice(0, 120) });
    console.log("threw");
  }
}

writeFileSync("auditor-comparison.json", JSON.stringify(results, null, 2));
console.log("\n" + "model".padEnd(26) + "caught  invented  issues  pass   sec");
for (const r of results) {
  if (r.error) { console.log(r.model.padEnd(26) + "-- " + r.error); continue; }
  console.log(
    r.model.padEnd(26) +
    `${r.caught.length}/3`.padEnd(8) +
    String(r.fabricated).padEnd(10) +
    String(r.issues).padEnd(8) +
    String(r.pass).padEnd(7) +
    String(r.seconds)
  );
}
