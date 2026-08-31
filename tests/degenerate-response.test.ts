import { describe, expect, it } from "vitest";
import { parseJsonObject } from "@/services/ai/practice-paper-generation.server";

/**
 * A model that collapses mid-batch.
 *
 * One mark-scheme batch returned 33,000 characters of degenerate token soup --
 * " worldBopre child only () defaultULats minconfig tem recatingier static" --
 * twice on the same question, running to its output cap. The SyntaxError from
 * parsing it propagated out of the request and ended the paper, discarding a
 * run that had already banked ten batches. They survived only because they were
 * checkpointed.
 *
 * An unreadable batch is a case the pipeline already handles by retrying that
 * batch. One unusable answer should cost its own call and nothing else.
 */
describe("a response that is not JSON at all", () => {
  it("reads an ordinary response", () => {
    expect(parseJsonObject('{"items":[{"questionId":"q1"}]}')).toEqual({
      items: [{ questionId: "q1" }],
    });
  });

  it("reads one wrapped in a code fence", () => {
    expect(parseJsonObject('```json\n{"items":[]}\n```')).toEqual({ items: [] });
  });

  it("reads one with prose around it", () => {
    expect(parseJsonObject('Here you go:\n{"items":[]}\nHope that helps.')).toEqual({ items: [] });
  });

  /** The real one, shortened. It has no braces and no structure. */
  it("returns an empty object for token soup rather than throwing", () => {
    const soup = " worldBopre child only () defaultULats minconfig tem recatingier static We comple " +
      "Youremuncdb product pointindows muchig".repeat(20);
    expect(() => parseJsonObject(soup)).not.toThrow();
    expect(parseJsonObject(soup)).toEqual({});
  });

  /** Braces present, still unparseable -- the slice must not rescue nonsense. */
  it("returns an empty object for broken JSON", () => {
    expect(parseJsonObject('{"items":[{"questionId":')).toEqual({});
  });

  it("returns an empty object for an empty response", () => {
    expect(parseJsonObject("")).toEqual({});
  });
});
