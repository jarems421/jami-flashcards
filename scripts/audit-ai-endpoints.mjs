import process from "node:process";

const BASE = "https://openrouter.ai/api/v1";

const ROLES = [
  {
    name: "worker",
    model: "xiaomi/mimo-v2.5",
    allowlist: ["novita", "parasail"],
    minimumContext: 1_048_576,
    quantizations: ["fp8", "bf16", "fp16", "fp32"],
    parameters: ["max_tokens", "response_format"],
  },
  {
    name: "supervisor",
    model: "minimax/minimax-m3",
    allowlist: ["parasail"],
    minimumContext: 1_000_000,
    quantizations: ["fp8", "bf16", "fp16", "fp32"],
    parameters: ["reasoning", "max_tokens", "response_format", "structured_outputs"],
  },
  {
    name: "juror",
    model: "moonshotai/kimi-k2.6",
    allowlist: ["moonshotai"],
    minimumContext: 262_144,
    quantizations: ["int4", "int8", "fp8", "bf16", "fp16", "fp32"],
    parameters: ["reasoning", "max_tokens", "response_format", "structured_outputs"],
  },
];

async function get(path) {
  const response = await fetch(`${BASE}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return (await response.json()).data ?? [];
}

const [zdr, providers, models] = await Promise.all([
  get("endpoints/zdr"),
  get("providers"),
  get("models"),
]);

const slugByName = new Map(
  providers.map((p) => [String(p.name ?? "").toLowerCase(), String(p.slug ?? "").toLowerCase()])
);

for (const role of ROLES) {
  console.log(`\n=== ${role.name}: ${role.model} ===`);
  const model = models.find((m) => m.id === role.model);
  console.log(
    `model listed: ${Boolean(model)}   image input: ${
      model?.architecture?.input_modalities?.includes("image") ?? false
    }`
  );

  const all = zdr.filter((e) => e.model_id === role.model);
  console.log(`ZDR endpoints for this model: ${all.length}`);

  for (const e of all) {
    const name = String(e.provider_name ?? "");
    const slug = slugByName.get(name.toLowerCase()) ?? "(unknown slug)";
    const ctx = Number(e.context_length ?? e.context_window ?? 0);
    const quant = String(e.quantization ?? "").toLowerCase();
    const supported = new Set((e.supported_parameters ?? []).map(String));
    const missing = role.parameters.filter((p) => !supported.has(p));
    const allowed = role.allowlist.some((a) => slug === a || slug.startsWith(`${a}/`));

    const verdict = [
      allowed ? null : "NOT IN ALLOWLIST",
      (e.status === undefined || Number(e.status) === 0) ? null : `status=${e.status}`,
      ctx >= role.minimumContext ? null : `context ${ctx.toLocaleString()} < ${role.minimumContext.toLocaleString()}`,
      role.quantizations.includes(quant) ? null : `quantization ${quant || "(none)"}`,
      missing.length === 0 ? null : `missing params: ${missing.join(",")}`,
    ].filter(Boolean);

    console.log(
      `  ${verdict.length === 0 ? "PASS" : "fail"}  ${slug.padEnd(24)} ctx=${String(ctx).padStart(9)} quant=${(quant || "-").padEnd(5)}${
        verdict.length ? `  <- ${verdict.join("; ")}` : ""
      }`
    );
  }
}
