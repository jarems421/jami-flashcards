import { describe, expect, it } from "vitest";
import {
  buildAiProviderPlan,
  classifyTutorTaskClass,
  resolveAiProviderPolicy,
} from "@/lib/ai/provider-policy";

const approved = {
  AI_TEXT_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "test-key",
  DEEPSEEK_ENABLED: "true",
  DEEPSEEK_PRIVACY_APPROVED: "true",
  DEEPSEEK_QUALITY_GATE_PASSED: "true",
  GEMINI_API_KEY: "gemini-key",
};

describe("AI provider policy", () => {
  it("does not enable DeepSeek from an API key alone", () => {
    expect(resolveAiProviderPolicy({
      AI_TEXT_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test-key",
      GEMINI_API_KEY: "gemini-key",
    })).toEqual({
      textProvider: "gemini",
      deepSeekReady: false,
      geminiReady: true,
    });
  });

  it("routes standard text through Flash twice, Pro, then Gemini", () => {
    const plan = buildAiProviderPlan({
      taskClass: "standard",
      hasVisualInput: false,
      policy: resolveAiProviderPolicy(approved),
    });
    expect(plan.map(({ model }) => model)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "gemini-2.5-flash",
    ]);
  });

  it("starts consequential work on Pro and keeps Flash as a candidate fallback", () => {
    const plan = buildAiProviderPlan({
      taskClass: "important",
      hasVisualInput: false,
      policy: resolveAiProviderPolicy(approved),
    });
    expect(plan.map(({ model }) => model)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "gemini-2.5-flash",
    ]);
  });

  it("routes any visual input only to Gemini", () => {
    const plan = buildAiProviderPlan({
      taskClass: "important",
      hasVisualInput: true,
      policy: resolveAiProviderPolicy(approved),
    });
    expect(plan.map(({ provider, model }) => `${provider}:${model}`)).toEqual([
      "gemini:gemini-2.5-flash",
      "gemini:gemini-2.5-flash-lite",
    ]);
  });

  it("honours the provider kill switch immediately", () => {
    const policy = resolveAiProviderPolicy({
      ...approved,
      DEEPSEEK_KILL_SWITCH: "true",
    });
    expect(policy.deepSeekReady).toBe(false);
    expect(policy.textProvider).toBe("gemini");
  });

  it("escalates difficult Tutor work without promoting ordinary questions", () => {
    expect(classifyTutorTaskClass({
      message: "Can you remind me what mitosis means?",
      sourceCount: 2,
    })).toBe("standard");
    expect(classifyTutorTaskClass({
      message: "Give me a full solution and derive the result step by step.",
      sourceCount: 2,
    })).toBe("important");
    expect(classifyTutorTaskClass({
      message: "Synthesize the relevant course material.",
      sourceCount: 10,
    })).toBe("important");
  });
});
