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
    fallbackModel: "xiaomi/mimo-v2.5",
    minimumContext: 1_048_576,
    requiresImageInput: true,
    acceptableQuantizations: ["fp8", "bf16", "fp16", "fp32"],
    requiredParameters: ["max_tokens", "response_format"],
  },
  {
    name: "supervisor",
    modelKey: "OPENROUTER_SUPERVISOR_MODEL",
    providersKey: "OPENROUTER_SUPERVISOR_PROVIDERS",
    fallbackModel: "minimax/minimax-m3",
    minimumContext: 1_000_000,
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
    minimumContext: 1_000_000,
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

function fail(message) {
  throw new Error(message);
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
if (process.argv.includes("--live")) await assertLiveEndpoints();
else process.stdout.write("AI release environment is internally consistent. Add --live to validate endpoints.\n");
