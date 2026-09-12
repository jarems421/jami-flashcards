import type { MarkedAnswer } from "@/lib/study/answer-marking";

/** Only content-free one-bit markers may accompany remote session state. */
export function studyPresentationFlags(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, flag]) => /^(counted:|retired:|hint-revisit:)/.test(key) && key.length <= 240 && flag === "1").slice(-1000));
}

/** Stored inside the existing local session drafts; never uploaded to Firestore. */
export type PresentationViewState = {
  hintUsed?: boolean;
  phase?: "checking" | "marked";
  result?: MarkedAnswer;
  chosenId?: string;
};

export function readPresentationViewState(value: unknown): PresentationViewState {
  if (typeof value !== "string") return {};
  try {
    const data = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const validResult = data.result && ["correct", "partial", "incorrect", "close", "needs-self-grade"].includes(data.result.verdict) &&
      ["numeric", "list", "short", "prose"].includes(data.result.shape);
    return {
      hintUsed: data.hintUsed === true,
      ...(data.phase === "checking" || data.phase === "marked" ? { phase: data.phase } : {}),
      ...(validResult ? { result: data.result } : {}),
      ...(typeof data.chosenId === "string" ? { chosenId: data.chosenId } : {}),
    };
  } catch { return {}; }
}
