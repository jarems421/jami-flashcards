import type { AiContentPart } from "@/lib/ai/content-parts";

export type AiProvider = "deepseek" | "gemini";
export type AiProviderModel =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite";

export type AiTaskClass = "standard" | "important" | "visual";

export type AiProviderAttempt = {
  provider: AiProvider;
  model: AiProviderModel;
  thinking: boolean;
};

export type AiProviderPolicy = {
  textProvider: "deepseek" | "gemini";
  deepSeekReady: boolean;
  geminiReady: boolean;
};

/**
 * A deliberately small, inspectable escalation rule for normal Tutor turns.
 * It avoids spending Pro tokens on ordinary explanations while promoting work
 * where a shallow first pass is more likely to mislead the student.
 */
export function classifyTutorTaskClass(input: {
  message: string;
  sourceCount: number;
}): AiTaskClass {
  const message = input.message.toLowerCase();
  const difficultRequest =
    /\b(full solution|step[- ]by[- ]step|prove|proof|derive|evaluate|critique|mark my|assess my|compare and contrast|synthesi[sz]e|research question|dissertation|examiner)\b/.test(
      message
    );
  return difficultRequest || input.sourceCount >= 8 || message.length >= 1_200
    ? "important"
    : "standard";
}

export function hasVisualAiInput(contents: readonly {
  parts: readonly AiContentPart[];
}[]) {
  return contents.some((message) =>
    message.parts.some((part) => "inlineData" in part)
  );
}

/**
 * One deterministic routing policy for every Jami AI feature.
 *
 * DeepSeek is deliberately gated by both privacy and quality approval. Adding
 * the API key alone cannot silently send student work to a new processor.
 */
export function resolveAiProviderPolicy(
  env: Record<string, string | undefined>
): AiProviderPolicy {
  const deepSeekReady = Boolean(
    env.DEEPSEEK_API_KEY?.trim() &&
      env.DEEPSEEK_ENABLED === "true" &&
      env.DEEPSEEK_PRIVACY_APPROVED === "true" &&
      env.DEEPSEEK_QUALITY_GATE_PASSED === "true" &&
      env.DEEPSEEK_KILL_SWITCH !== "true"
  );
  const geminiReady = Boolean(env.GEMINI_API_KEY?.trim());
  return {
    textProvider:
      env.AI_TEXT_PROVIDER === "deepseek" && deepSeekReady
        ? "deepseek"
        : "gemini",
    deepSeekReady,
    geminiReady,
  };
}

export function buildAiProviderPlan(input: {
  taskClass: AiTaskClass;
  hasVisualInput: boolean;
  policy: AiProviderPolicy;
  forceModel?: AiProviderModel;
}): AiProviderAttempt[] {
  const { policy } = input;
  if (input.forceModel) {
    const provider = input.forceModel.startsWith("deepseek-")
      ? "deepseek"
      : "gemini";
    if (
      (provider === "deepseek" && !policy.deepSeekReady) ||
      (provider === "gemini" && !policy.geminiReady)
    ) {
      return [];
    }
    return [{
      provider,
      model: input.forceModel,
      thinking: input.forceModel === "deepseek-v4-pro",
    }];
  }

  if (input.hasVisualInput || input.taskClass === "visual") {
    return policy.geminiReady
      ? [
          { provider: "gemini", model: "gemini-2.5-flash", thinking: false },
          { provider: "gemini", model: "gemini-2.5-flash-lite", thinking: false },
        ]
      : [];
  }

  if (policy.textProvider !== "deepseek") {
    return policy.geminiReady
      ? [
          { provider: "gemini", model: "gemini-2.5-flash", thinking: false },
          { provider: "gemini", model: "gemini-2.5-flash-lite", thinking: false },
        ]
      : [];
  }

  const deepSeek = input.taskClass === "important"
    ? [
        { provider: "deepseek", model: "deepseek-v4-pro", thinking: true },
        { provider: "deepseek", model: "deepseek-v4-pro", thinking: true },
        { provider: "deepseek", model: "deepseek-v4-flash", thinking: false },
      ] satisfies AiProviderAttempt[]
    : [
        { provider: "deepseek", model: "deepseek-v4-flash", thinking: false },
        { provider: "deepseek", model: "deepseek-v4-flash", thinking: false },
        { provider: "deepseek", model: "deepseek-v4-pro", thinking: true },
      ] satisfies AiProviderAttempt[];

  return policy.geminiReady
    ? [
        ...deepSeek,
        { provider: "gemini", model: "gemini-2.5-flash", thinking: false },
      ]
    : deepSeek;
}
