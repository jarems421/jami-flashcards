/**
 * Which models could serve as supervisor at all, by the bar the audit applies.
 *
 * The supervisor allowlist holds one provider, that provider is saturated, and
 * "only one endpoint qualifies" was asserted from a list of endpoints for one
 * model. This asks the wider question: across every ZDR endpoint OpenRouter
 * offers, which models clear full context, fp8-or-better, structured outputs
 * and image input, and how many distinct providers serve each?
 *
 * More providers per model is resilience. One is what we have now.
 */
const BASE = "https://openrouter.ai/api/v1";
const key = process.env.OPENROUTER_API_KEY;
const get = async (p) => (await (await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${key}` } })).json()).data;

const [zdr, models] = await Promise.all([get("endpoints/zdr"), get("models")]);
const GOOD_QUANT = new Set(["fp8", "bf16", "fp16", "fp32"]);
const NEEDED = ["reasoning", "max_tokens", "response_format", "structured_outputs"];
const MIN_CONTEXT = 1_000_000;

const byModel = new Map();
for (const e of zdr) {
  const ctx = e.context_length ?? 0;
  const quant = String(e.quantization ?? "unknown");
  const params = new Set(e.supported_parameters ?? []);
  if (ctx < MIN_CONTEXT) continue;
  if (!GOOD_QUANT.has(quant)) continue;
  if (!NEEDED.every((p) => params.has(p))) continue;
  const m = models.find((x) => x.id === e.model_id);
  if (!m?.architecture?.input_modalities?.includes("image")) continue;
  if (!byModel.has(e.model_id)) byModel.set(e.model_id, []);
  byModel.get(e.model_id).push({ provider: e.provider_name ?? e.name, ctx, quant });
}

const rows = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`models clearing every supervisor requirement: ${rows.length}\n`);
console.log("providers  model".padEnd(52) + "endpoints");
for (const [model, eps] of rows) {
  console.log(String(eps.length).padStart(9) + "  " + model.padEnd(40) + eps.map((e) => e.provider).join(", ").slice(0, 70));
}
