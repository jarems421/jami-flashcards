import { describe, expect, it } from "vitest";
import { AiAbortError } from "@/lib/ai/abort";

/**
 * Why a request stopped, read from a type rather than from prose.
 *
 * The abort reason used to be a bare string. `fetch` rejects with whatever the
 * reason is, so the rejection was a string, and every check downstream asked
 * `error instanceof Error` first and got false. Two client-side timeouts were
 * therefore logged as `provider_error`, and the investigation went looking for
 * an outage that had not happened.
 *
 * The three cases are genuinely different and a message cannot be trusted to
 * tell them apart: an attempt's own budget running out, the whole operation's
 * budget running out, and the caller going away.
 */
describe("an aborted AI request", () => {
  it("is an Error, so nothing downstream silently misreads it", () => {
    const error = new AiAbortError("call_timeout");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AiAbortError");
  });

  it("carries its reason as a kind, not as wording to match on", () => {
    expect(new AiAbortError("call_timeout").kind).toBe("call_timeout");
    expect(new AiAbortError("deadline").kind).toBe("deadline");
    expect(new AiAbortError("cancelled").kind).toBe("cancelled");
  });

  /*
   * A deadline is not a call timeout wearing a different hat. Retrying the
   * attempt can help the first and cannot help the second, so they have to be
   * distinguishable at the point something decides whether to try again.
   */
  it("separates the attempt's budget from the operation's", () => {
    const kinds = ["call_timeout", "deadline", "cancelled"] as const;
    const messages = kinds.map((kind) => new AiAbortError(kind).message);
    expect(new Set(messages).size).toBe(kinds.length);
  });

  /*
   * The limit of what any of this establishes. A client abort says this end
   * stopped waiting. It does not say the provider stopped working, was queued,
   * stalled, or generated tokens that were billed -- and the timings on this
   * side cannot tell those apart.
   */
  it("says nothing about what the provider was doing", () => {
    const error = new AiAbortError("call_timeout");
    expect(Object.keys(error)).not.toContain("providerState");
    expect(Object.keys(error)).not.toContain("billed");
  });
});
