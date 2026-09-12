import { mergeGapOutcomes, validateSemanticResult, type GapOutcome } from "@/lib/study/semantic-validation";

/** At most one bounded second assessment; neither call sees the other's verdict. */
export async function runStudySemanticCheck(
  call: (remainingMs: number) => Promise<string>, response: string,
  gaps: Array<GapOutcome & { response: string }>, deadlineAt: number
): Promise<string> {
  const unsure = JSON.stringify({ verdict: "needs-self-grade", confidence: 0 });
  const unresolved = gaps.filter((gap) => gap.verdict === "needs-self-grade" || gap.verdict === "close");
  if (gaps.length && !unresolved.length) {
    const merged = mergeGapOutcomes(gaps);
    return JSON.stringify({ verdict: merged.verdict, gapResults: merged.outcomes, confidence: 1 });
  }
  let firstSignature: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 1_000) return unsure;
    let parsed: Record<string, unknown>;
    let text: string;
    try { text = await call(remaining); } catch { return unsure; }
    try {
      parsed = JSON.parse((/```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text).trim());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    } catch { continue; }
    const candidates = Array.isArray(parsed.gapResults) ? parsed.gapResults : [];
    const signature = JSON.stringify(gaps.length ? candidates.map((item) => [item?.gapId, item?.verdict]) : parsed.verdict);
    if (firstSignature && firstSignature !== signature) return unsure;
    if (gaps.length) {
      const checked: GapOutcome[] = [];
      for (const gap of unresolved) {
        const matches = candidates.filter((item) => item?.gapId === gap.gapId);
        const result = matches.length === 1 ? validateSemanticResult(matches[0], gap.response) : null;
        if (result) checked.push({ gapId: gap.gapId, verdict: result.verdict as GapOutcome["verdict"], feedback: String(result.feedback).slice(0, 240) });
      }
      if (checked.length === unresolved.length) {
        const merged = mergeGapOutcomes(gaps, checked);
        return JSON.stringify({ verdict: merged.verdict, gapResults: merged.outcomes, confidence: 1 });
      }
    } else {
      const checked = validateSemanticResult(parsed, response);
      if (checked) return JSON.stringify({ ...checked, confidence: 1 });
    }
    // A malformed result can be repaired. A stated decision may not be reversed
    // by the second assessment without falling back to the student.
    if (["correct", "partial", "incorrect"].includes(String(parsed.verdict))) firstSignature = signature;
  }
  return unsure;
}
