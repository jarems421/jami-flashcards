import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/lib/app/elapsed-time";

describe("formatElapsed", () => {
  it("reads like a clock", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(42_400)).toBe("0:42");
    expect(formatElapsed(245_000)).toBe("4:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  it("never runs backwards or breaks on a bad start time", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });
});
