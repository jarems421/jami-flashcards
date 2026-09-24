import { describe, expect, it } from "vitest";
import { AiAbortError } from "@/lib/ai/abort";
import { failedMarkingExecution, markingFailureCause } from "@/lib/practice/marking-execution-audit";
import { PracticePaperMarkingFailedError } from "@/lib/practice/marker-stages";

describe("private failed marking accounting", () => {
  it("preserves known charges without treating an incomplete bill as settled", () => {
    const error = new PracticePaperMarkingFailedError("private provider payload", { usd: 0.03, unreportedCalls: 1 }, false);
    expect(failedMarkingExecution(error)).toEqual({
      status: "failed", cause: "invalid_report", costAccounting: { usd: 0.03, unreportedCalls: 1 }, billingKnown: false,
    });
  });
  it("does not invent zero cost or retain provider payloads for an unknown failure", () => {
    const audit = failedMarkingExecution(new Error("private answer"));
    expect(audit).toEqual({ status: "failed", cause: "unknown", billingKnown: false });
    expect(JSON.stringify(audit)).not.toContain("private");
  });
});

describe("why a marking failed, without what it said", () => {
  it("names a provider refusal by its status", () => {
    // Production, 24 September 2026: the supervisor pinned to a retired model, refused by every approved endpoint.
    const refused = Object.assign(new Error("No endpoints found for minimax/minimax-m3 with the answer: 'cytoplasm'"), { status: 404 });
    expect(markingFailureCause(refused)).toBe("provider_http_404");
  });
  it("names a timeout, and keeps the job's own codes", () => {
    expect(markingFailureCause(new AiAbortError("deadline"))).toBe("abort_deadline");
    expect(markingFailureCause(new Error("scheme_mismatch"))).toBe("scheme_mismatch");
    expect(markingFailureCause(new TypeError("cannot read 'answer' of undefined"))).toBe("exception_TypeError");
  });
});
