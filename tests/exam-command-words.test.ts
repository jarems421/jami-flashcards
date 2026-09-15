import { describe, expect, it } from "vitest";
import { normalizeCommandWord } from "@/lib/practice/exam-command-words";

/**
 * A command word is a fact of the printed question or it is nothing.
 *
 * The extraction model reads it off the paper; this decides whether what it
 * returned is really there, so a guess never becomes data about a student's
 * answers.
 */
describe("command words", () => {
  it("keeps a command word the question prints, in one canonical form", () => {
    expect(normalizeCommandWord("Work out", "Work out the value of x.")).toBe("Work out");
    expect(normalizeCommandWord("SHOW THAT", "Show that the triangle is right-angled.")).toBe("Show that");
    expect(normalizeCommandWord(" explain. ", "(b) Explain why the rate increases.")).toBe("Explain");
  });

  it("finds a phrase the paper broke across a line", () => {
    expect(normalizeCommandWord("Show that", "Show\nthat 3x + 2 = 14 has the solution x = 4")).toBe("Show that");
  });

  it("drops a command word the question never prints", () => {
    expect(normalizeCommandWord("Evaluate", "Calculate the mean.")).toBeUndefined();
    // Part of a word is not the word.
    expect(normalizeCommandWord("Calc", "Calculate the mean.")).toBeUndefined();
  });

  it("drops anything that is not a short phrase", () => {
    expect(normalizeCommandWord("", "Explain your answer.")).toBeUndefined();
    expect(normalizeCommandWord(42, "Explain your answer.")).toBeUndefined();
    expect(
      normalizeCommandWord("Use the graph to estimate", "Use the graph to estimate the speed.")
    ).toBeUndefined();
  });
});
