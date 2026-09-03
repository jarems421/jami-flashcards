import process from "node:process";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUIRED_GATES = [
  "OPENROUTER_ENABLED",
  "OPENROUTER_PRIVACY_APPROVED",
  "OPENROUTER_QUALITY_GATE_PASSED",
];

const ROLES = [
  {
    name: "worker",
    modelKey: "OPENROUTER_WORKER_MODEL",
    providersKey: "OPENROUTER_WORKER_PROVIDERS",
    // Must equal DEFAULT_MODELS.worker in lib/ai/provider-policy.ts. This is a
    // .mjs script and that is TypeScript, so the value is copied rather than
    // imported -- `ai-provider-policy.test.ts` fails if the two ever disagree,
    // because a gate validating a model the app does not use is worse than no
    // gate at all.
    fallbackModel: "z-ai/glm-5.3-flash",
    minimumContext: 1_048_576,
    requiresImageInput: true,
    acceptableQuantizations: ["fp8", "bf16", "fp16", "fp32"],
    requiredParameters: ["max_tokens", "response_format"],
  },
  {
    name: "supervisor",
    modelKey: "OPENROUTER_SUPERVISOR_MODEL",
    providersKey: "OPENROUTER_SUPERVISOR_PROVIDERS",
    // Must equal DEFAULT_MODELS.supervisor in lib/ai/provider-policy.ts;
    // ai-provider-policy.test.ts fails if they disagree.
    fallbackModel: "qwen/qwen3.6-35b-a3b",
    /*
     * 256K, and the number is measured rather than inherited.
     *
     * This was 1,000,000, which is what a supervisor would need if raw sources
     * reached it. They do not: every source goes through Gemini's documentVision
     * first and arrives as extracted text capped at 30,000 characters, and a
     * paper takes at most 15 of them (MAX_PRACTICE_PAPER_SOURCE_IDS). So the
     * true worst case is 15 x 30,000 + a 12,000-character research brief +
     * instructions = 477,000 characters. Measured against assessment-shaped
     * prose at 4.67 characters per token, that is ~102,000 input tokens, and
     * ~118,000 with the output allowance.
     *
     * A 1M floor was therefore asking for eight times the headroom the role can
     * use, and it cost real safety: only six models on the whole zero-retention
     * catalogue could clear it, which left the supervisor -- the role that
     * generates papers and marks work -- on a single endpoint. 256K is a little
     * over twice the measured ceiling.
     */
    minimumContext: 256_000,
    requiresImageInput: true,
    acceptableQuantizations: ["fp8", "bf16", "fp16", "fp32"],
    requiredParameters: ["reasoning", "max_tokens", "response_format", "structured_outputs"],
  },
  {
    // Held in reserve for the supervisor, whose primary model has exactly one
    // compliant endpoint. It is checked to the same bar as the role it stands
    // in for: a standby only discovered to be stale mid-outage is not one.
    name: "supervisor standby",
    modelKey: "OPENROUTER_SUPERVISOR_STANDBY_MODEL",
    providersKey: "OPENROUTER_SUPERVISOR_STANDBY_PROVIDERS",
    fallbackModel: "moonshotai/kimi-k3",
    // The standby stands in for the supervisor, so it needs what the supervisor
    // needs and no more.
    minimumContext: 256_000,
    requiresImageInput: true,
    acceptableQuantizations: ["fp8", "bf16", "fp16", "fp32"],
    requiredParameters: ["reasoning", "max_tokens", "response_format", "structured_outputs"],
  },
  {
    name: "juror",
    modelKey: "OPENROUTER_JUROR_MODEL",
    providersKey: "OPENROUTER_JUROR_PROVIDERS",
    fallbackModel: "moonshotai/kimi-k2.6",
    minimumContext: 262_144,
    requiresImageInput: true,
    // Moonshot's first-party ZDR endpoint currently serves Kimi at INT4.
    acceptableQuantizations: ["int4", "int8", "fp8", "bf16", "fp16", "fp32"],
    requiredParameters: ["reasoning", "max_tokens", "response_format", "structured_outputs"],
  },
];

function splitList(value) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

/*
 * Every failure, not the first one.
 *
 * `fail` threw, and `assertOfflineConfiguration()` ran before the live endpoint
 * checks -- so on any machine missing one unrelated production flag the script
 * died before it ever asked OpenRouter anything. That is how a worker allowlist
 * naming an endpoint that does not serve the worker's model reached production:
 * the check that exists to catch exactly that was never reached, and the only
 * line of output said `PRACTICE_PAPER_MARKING_WORKFLOW_ENABLED must be true`.
 *
 * Collecting instead means a local config gap reports itself as a local config
 * gap and the endpoint validation still runs and still speaks up.
 */
const failures = [];

function fail(message) {
  failures.push(message);
}

function assertOfflineConfiguration() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) fail("OPENROUTER_API_KEY is missing.");
  for (const gate of REQUIRED_GATES) {
    if (process.env[gate] !== "true") fail(`${gate} must be true.`);
  }
  if (process.env.OPENROUTER_KILL_SWITCH === "true") {
    fail("OPENROUTER_KILL_SWITCH is active.");
  }
  if (process.env.OPENROUTER_JUROR_KILL_SWITCH === "true") {
    fail("OPENROUTER_JUROR_KILL_SWITCH is active.");
  }
  if (!process.env.GEMINI_API_KEY?.trim()) fail("GEMINI_API_KEY is missing.");
  for (const gate of [
    "GEMINI_ENABLED",
    "GEMINI_PRIVACY_APPROVED",
    "GEMINI_QUALITY_GATE_PASSED",
  ]) {
    if (process.env[gate] !== "true") fail(`${gate} must be true.`);
  }
  if (process.env.GEMINI_KILL_SWITCH === "true") {
    fail("GEMINI_KILL_SWITCH is active.");
  }
  if (process.env.PRACTICE_PAPER_MARKING_WORKFLOW_ENABLED !== "true") {
    fail("PRACTICE_PAPER_MARKING_WORKFLOW_ENABLED must be true for a production AI release.");
  }
  const markingConcurrency = Number.parseInt(
    process.env.PRACTICE_PAPER_MARKING_JOB_CONCURRENCY || "4",
    10
  );
  if (!Number.isInteger(markingConcurrency) || markingConcurrency < 1 || markingConcurrency > 20) {
    fail("PRACTICE_PAPER_MARKING_JOB_CONCURRENCY must be between 1 and 20.");
  }
  const markingCost = Number.parseFloat(
    process.env.PRACTICE_PAPER_MARKING_MAX_COST_USD || "0.50"
  );
  if (!Number.isFinite(markingCost) || markingCost < 0.05 || markingCost > 5) {
    fail("PRACTICE_PAPER_MARKING_MAX_COST_USD must be between 0.05 and 5.00.");
  }
  for (const role of ROLES) {
    if (splitList(process.env[role.providersKey]).length === 0) {
      fail(`${role.providersKey} must contain an explicit provider allowlist.`);
    }
  }
  const deprecated = Object.keys(process.env).filter((key) => key.startsWith("DEEPSEEK_"));
  if (deprecated.length > 0) {
    fail(`Remove deprecated DeepSeek variables: ${deprecated.join(", ")}.`);
  }
}

function endpointProvider(endpoint) {
  return String(endpoint.provider_name ?? "").trim();
}

function endpointContext(endpoint) {
  const value = endpoint.context_length ?? endpoint.context_window;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function endpointHasAcceptablePrecision(endpoint, acceptableQuantizations) {
  return acceptableQuantizations.includes(
    String(endpoint.quantization ?? "").toLowerCase()
  );
}

function endpointSupportsRequiredParameters(endpoint, requiredParameters) {
  const supported = Array.isArray(endpoint.supported_parameters)
    ? new Set(endpoint.supported_parameters.map((value) => String(value)))
    : new Set();
  return requiredParameters.every((parameter) => supported.has(parameter));
}

async function getApiCollection(path) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) fail(`OpenRouter ${path} check failed (${response.status}).`);
  const body = await response.json();
  return Array.isArray(body?.data) ? body.data : [];
}

function modelSupportsImages(model) {
  const modalities = model.architecture?.input_modalities;
  return Array.isArray(modalities) && modalities.includes("image");
}

async function assertLiveEndpoints() {
  const [zdrEndpoints, providers, models] = await Promise.all([
    getApiCollection("endpoints/zdr"),
    getApiCollection("providers"),
    getApiCollection("models"),
  ]);
  const providerSlugsByName = new Map(
    providers.map((provider) => [
      String(provider.name ?? "").toLowerCase(),
      String(provider.slug ?? "").toLowerCase(),
    ])
  );
  for (const role of ROLES) {
    const model = process.env[role.modelKey]?.trim() || role.fallbackModel;
    const allowlist = splitList(process.env[role.providersKey]).map((item) => item.toLowerCase());
    const modelRecord = models.find((candidate) => candidate.id === model);
    if (!modelRecord) fail(`Configured ${role.name} model ${model} is unavailable.`);
    if (role.requiresImageInput && !modelSupportsImages(modelRecord)) {
      fail(`Configured ${role.name} model ${model} does not advertise image input.`);
    }
    const compliant = zdrEndpoints.filter((endpoint) => {
      if (endpoint.model_id !== model) return false;
      const providerSlug = providerSlugsByName.get(endpointProvider(endpoint).toLowerCase());
      const allowed = providerSlug && allowlist.some(
        (slug) => providerSlug === slug || providerSlug.startsWith(`${slug}/`)
      );
      return allowed &&
        (endpoint.status === undefined || Number(endpoint.status) === 0) &&
        endpointContext(endpoint) >= role.minimumContext &&
        endpointHasAcceptablePrecision(endpoint, role.acceptableQuantizations) &&
        endpointSupportsRequiredParameters(endpoint, role.requiredParameters);
    });
    if (compliant.length === 0) {
      fail(
        `No approved ZDR, multimodal, full-context endpoint is currently available for ${role.name}.`
      );
    }
    const compliantProviderSlugs = new Set(
      compliant.flatMap((endpoint) => {
        const slug = providerSlugsByName.get(endpointProvider(endpoint).toLowerCase());
        return slug ? [slug] : [];
      })
    );
    const nonCompliantAllowlistEntries = allowlist.filter(
      (allowedSlug) =>
        ![...compliantProviderSlugs].some(
          (providerSlug) =>
            providerSlug === allowedSlug || providerSlug.startsWith(`${allowedSlug}/`)
        )
    );
    if (nonCompliantAllowlistEntries.length > 0) {
      fail(
        `${role.providersKey} includes provider(s) without a currently compliant endpoint: ${nonCompliantAllowlistEntries.join(", ")}. Remove them before release.`
      );
    }
    process.stdout.write(
      `${role.name}: ${model} has ${compliant.length} compliant endpoint(s).\n`
    );
  }
}

assertOfflineConfiguration();

if (process.argv.includes("--live")) {
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    await assertLiveEndpoints();
  } else {
    fail("Cannot validate endpoints without OPENROUTER_API_KEY.");
  }
} else if (failures.length === 0) {
  process.stdout.write(
    "AI release environment is internally consistent. Add --live to validate endpoints.\n"
  );
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} AI release problem(s):\n`);
  for (const message of failures) process.stderr.write(`  - ${message}\n`);
  process.exit(1);
}

process.stdout.write("AI release checks passed.\n");
