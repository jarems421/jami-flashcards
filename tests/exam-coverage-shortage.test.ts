import { describe, expect, it } from "vitest";
import { readCoverageShortage } from "@/services/study/exam-practice";

/**
 * The shortage response, as the client actually receives it.
 *
 * This existed and never once worked: the detail was encoded as
 * `coverage_gap:{"easy":2}` and split on ":", which cuts at the first colon
 * inside the JSON, so the parse failed every time, the missing mix was always
 * undefined, and the card offering Jami-created questions never rendered. A
 * student who asked for more questions than the bank held got a bare error and
 * no way forward.
 */
describe("reading a coverage shortage", () => {
  const shortage = {
    code: "coverage_gap",
    detail: {
      missingByDifficulty: { medium: 2, hard: 1 },
      availableMix: { easy: 2, medium: 1, hard: 0 },
    },
  };

  it("reads the missing and available mixes the server sent", () => {
    expect(readCoverageShortage(shortage)).toEqual({
      missingByDifficulty: { medium: 2, hard: 1 },
      availableMix: { easy: 2, medium: 1, hard: 0 },
    });
  });

  it("ignores anything that is not a shortage", () => {
    expect(readCoverageShortage({ code: "course_required", detail: {} })).toBeNull();
    expect(readCoverageShortage(new Error("network"))).toBeNull();
    expect(readCoverageShortage(null)).toBeNull();
  });

  it("refuses a shortage missing either half, rather than half-rendering the offer", () => {
    expect(readCoverageShortage({ code: "coverage_gap", detail: { availableMix: {} } })).toBeNull();
    expect(
      readCoverageShortage({ code: "coverage_gap", detail: { missingByDifficulty: {} } })
    ).toBeNull();
  });
});
