import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiResponseDiagnostics } from "@/lib/ai/provider-router";

/**
 * Generation's cost ceiling.
 *
 * Marking has had one since it went durable; generation, the longer pipeline,
 * had none. The standby supervisor bills output at fifteen times the usual
 * rate, so a run that failed over could spend without limit.
 */

const generateAiText = vi.fn();
const readCheckpoint = vi.fn();

vi.mock("@/lib/ai/provider-router", () => ({
  generateAiText,
  generateAiTextBufferedStream: generateAiText,
}));
vi.mock("@/lib/ai/generation-capture", () => ({ captureGenerationPass: vi.fn() }));
vi.mock("@/lib/ai/generation-checkpoint", () => ({
  readGenerationCheckpoint: readCheckpoint,
  writeGenerationCheckpoint: vi.fn(),
}));
vi.mock("@/services/ai/budgets", () => ({ getAiTokenCap: () => 24_000 }));
vi.mock("@/services/ai/practice-paper-generation-request.server", () => ({
  PAPER_PASS_STALL_TIMEOUT_MS: 60_000,
}));

const {
  createGenerationPassRunner,
  generationCostCeilingUsd,
  PracticePaperGenerationCostLimitError,
} = await import("@/services/ai/practice-paper-generation-passes.server");

const { createLogger } = await import("@/lib/observability/logger");
const log = createLogger({ route: "test.generation-cost-ceiling" });

function runner(diagnostics: AiResponseDiagnostics[], maxEstimatedCostUsd?: number) {
  return createGenerationPassRunner({
    durableRequest: false,
    providerTimeoutMs: 60_000,
    requestDeadlineMs: 600_000,
    startedAt: Date.now(),
    signal: new AbortController().signal,
    log,
    diagnostics,
    ...(maxEstimatedCostUsd === undefined ? {} : { maxEstimatedCostUsd }),
  });
}

/** A provider call that reports what it cost, as OpenRouter does. */
function billedCall(costUsd: number) {
  generateAiText.mockImplementationOnce(async (options: { onResponse?: (item: AiResponseDiagnostics) => void }) => {
    options.onResponse?.({
      provider: "openrouter",
      role: "supervisor",
      routeReason: "explicit_role",
      modelName: "moonshotai/kimi-k3",
      latencyMs: 10,
      estimatedCostUsd: costUsd,
    });
    return "{}";
  });
}

const pass = {
  name: "paper_design",
  taskClass: "important" as const,
  role: "supervisor" as const,
  systemInstruction: "Design a paper.",
  contents: [{ role: "user" as const, parts: [{ text: "request" }] }],
  temperature: 0.2,
};

describe("practice-paper generation cost ceiling", () => {
  beforeEach(() => {
    generateAiText.mockReset();
    readCheckpoint.mockReset();
    readCheckpoint.mockReturnValue(null);
  });

  it("stops the run before the next pass once reported spend reaches the ceiling", async () => {
    const run = runner([], 1);
    billedCall(0.6);
    billedCall(0.5);
    await run(pass);
    await run(pass);

    await expect(run(pass)).rejects.toBeInstanceOf(PracticePaperGenerationCostLimitError);
    expect(generateAiText).toHaveBeenCalledTimes(2);
  });

  it("lets a normal paper's spend through untouched", async () => {
    const run = runner([], 1);
    for (let index = 0; index < 28; index += 1) billedCall(0.01);
    for (let index = 0; index < 28; index += 1) await run(pass);
    expect(generateAiText).toHaveBeenCalledTimes(28);
  });

  it("still reuses a checkpointed pass past the ceiling, because it costs nothing", async () => {
    const run = runner([], 1);
    billedCall(1.2);
    await run(pass);
    readCheckpoint.mockReturnValueOnce({ text: "{\"saved\":true}", modelName: "saved" });

    await expect(run({ ...pass, checkpoint: { pass: "paper_design", subject: ["q1"] } })).resolves.toEqual({
      text: "{\"saved\":true}",
      modelName: "saved",
    });
  });

  it("has no ceiling when none is given, as before", async () => {
    const run = runner([]);
    billedCall(5);
    billedCall(5);
    await run(pass);
    await expect(run(pass)).resolves.toMatchObject({ text: "{}" });
  });

  it("reads the ceiling from the environment, clamped, defaulting to one dollar", () => {
    expect(generationCostCeilingUsd({})).toBe(1);
    expect(generationCostCeilingUsd({ PRACTICE_PAPER_GENERATION_MAX_COST_USD: "2.5" })).toBe(2.5);
    expect(generationCostCeilingUsd({ PRACTICE_PAPER_GENERATION_MAX_COST_USD: "40" })).toBe(5);
    expect(generationCostCeilingUsd({ PRACTICE_PAPER_GENERATION_MAX_COST_USD: "0" })).toBe(0.1);
    expect(generationCostCeilingUsd({ PRACTICE_PAPER_GENERATION_MAX_COST_USD: "nope" })).toBe(1);
  });
});
