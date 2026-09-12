import { describe, expect, it } from "vitest";
import { failedMarkingExecution } from "@/lib/practice/marking-execution-audit";
import { PracticePaperMarkingFailedError } from "@/lib/practice/marker-stages";

describe("private failed marking accounting", () => {
  it("preserves known charges without treating an incomplete bill as settled", () => {
    const error = new PracticePaperMarkingFailedError("private provider payload", { usd: 0.03, unreportedCalls: 1 }, false);
    expect(failedMarkingExecution(error)).toEqual({ status: "failed", costAccounting: { usd: 0.03, unreportedCalls: 1 }, billingKnown: false });
  });
  it("does not invent zero cost or retain provider payloads for an unknown failure", () => {
    expect(failedMarkingExecution(new Error("private answer"))).toEqual({ status: "failed", billingKnown: false });
  });
});
