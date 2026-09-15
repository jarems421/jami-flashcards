import { describe, expect, it } from "vitest";
import { MIN_COMMAND_WORD_ITEMS, buildCommandWordSignals } from "@/lib/learning/profile/command-words";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Reading a student's marked answers by the instruction each question gave.
 *
 * What these guard is the size of the claim: a pattern across different
 * questions, never one question or one answer.
 */

const NOW = Date.UTC(2026, 8, 15);
const DAY = 24 * 60 * 60 * 1000;

function observation(id: string, commandWord: string | undefined, score: number): LearningObservation {
  return {
    kind: "past-paper",
    evidenceId: id,
    itemId: `exam:${id}`,
    topicKeys: ["spec:aqa-8300-probability"],
    score,
    weight: 1,
    count: 1,
    at: NOW - DAY,
    trendEligible: true,
    errorChecks: [],
    ...(commandWord ? { commandWord } : {}),
  };
}

describe("command word signals", () => {
  it("describes a command word only across enough different questions", () => {
    const signals = buildCommandWordSignals(
      [
        observation("a", "Explain", 0),
        observation("b", "Explain", 0.5),
        observation("c", "Explain", 0),
        observation("d", "Calculate", 1),
        observation("e", "Calculate", 1),
        observation("f", undefined, 0),
      ],
      NOW
    );
    expect(signals.map((signal) => signal.commandWord)).toEqual(["Explain"]);
    expect(signals[0]).toMatchObject({ attempts: 3, uniqueItems: MIN_COMMAND_WORD_ITEMS });
    expect(signals[0]?.accuracy).toBeCloseTo(0.5 / 3, 5);
  });

  it("does not let one question answered again and again stand for a pattern", () => {
    const repeated = ["a", "b", "c", "d"].map((id) => ({ ...observation(id, "Show that", 0), itemId: "exam:same" }));
    expect(buildCommandWordSignals(repeated, NOW)).toEqual([]);
  });

  it("puts the instruction costing the most marks, most surely, first", () => {
    const asked = (word: string, score: number) =>
      ["1", "2", "3", "4"].map((suffix) => observation(`${word}-${suffix}`, word, score));
    const signals = buildCommandWordSignals([...asked("Calculate", 0.9), ...asked("Show that", 0.2)], NOW);
    expect(signals.map((signal) => signal.commandWord)).toEqual(["Show that", "Calculate"]);
  });
});
