import { describe, expect, it } from "vitest";
import {
  gapCandidates,
  needsBankLookup,
  settleGap,
} from "@/lib/learning/interventions/gap-detection";
import {
  MIN_COVERED_ITEMS,
  buildConceptCoverage,
} from "@/lib/learning/interventions/coverage";
import type { LearningTopicState } from "@/lib/learning/types";

/**
 * Asking the banks only where the answer could change what Jami says.
 *
 * The corpus scan costs more than a whole profile build, so the test that
 * matters is not "is it fast" but "is it asked for the right concepts, and
 * never asked for concepts already settled".
 */

function topic(overrides: Partial<LearningTopicState> = {}): LearningTopicState {
  return {
    topicKey: "spec:completing-the-square",
    label: "Completing the square",
    source: "specification",
    provenance: "verified_specification",
    declared: true,
    exposure: { notebooks: 0, sources: 0, cards: 0 },
    demonstration: "none",
    memory: [],
    ...overrides,
  } as LearningTopicState;
}

function coverageFor(topics: LearningTopicState[]) {
  return new Map(topics.map((entry) => [entry.topicKey, buildConceptCoverage(entry)]));
}

describe("deciding what is worth asking about", () => {
  it("asks about a concept the student has nothing for", () => {
    expect(needsBankLookup(buildConceptCoverage(topic()))).toBe(true);
  });

  it("does not ask about a concept already stocked with cards", () => {
    const stocked = topic({ exposure: { notebooks: 0, sources: 0, cards: 30 } });
    expect(needsBankLookup(buildConceptCoverage(stocked))).toBe(false);
  });

  it("counts notebooks and sources, not just cards", () => {
    // Phase B's threshold, read from Phase B, so the two cannot drift apart.
    const withNotes = topic({
      exposure: { notebooks: MIN_COVERED_ITEMS, sources: 0, cards: 0 },
    });
    expect(needsBankLookup(buildConceptCoverage(withNotes))).toBe(false);
  });

  it("ignores what the banks hold when deciding whether to ask them", () => {
    // Otherwise the question would answer itself with the answer it is seeking.
    const withBankCounts = buildConceptCoverage(topic(), { pastPaper: 40, practice: 40 });
    expect(needsBankLookup(withBankCounts)).toBe(true);
  });
});

describe("which concepts get the expensive lookup", () => {
  it("takes only declared specification concepts that are thin", () => {
    const thin = topic({ topicKey: "spec:a" });
    const stocked = topic({ topicKey: "spec:b", exposure: { notebooks: 0, sources: 0, cards: 20 } });
    const student = topic({ topicKey: "topic:mine", source: "student-topic" });
    const undeclared = topic({ topicKey: "spec:c", declared: false });
    const all = [thin, stocked, student, undeclared];

    const candidates = gapCandidates(all, coverageFor(all));
    expect(candidates.map((entry) => entry.topicKey)).toEqual(["spec:a"]);
  });

  it("asks about a concept it has no coverage reading for at all", () => {
    const unknown = topic({ topicKey: "spec:unseen" });
    const candidates = gapCandidates([unknown], new Map());
    expect(candidates).toHaveLength(1);
  });
});

describe("settling whether it is really a gap", () => {
  const readable = { pastPaperAvailable: true, practiceAvailable: true };

  it("is not a gap when the corpus can serve it", () => {
    expect(settleGap({ ownMaterial: 0, pastPaper: 14, practice: 0, ...readable })).toBe(
      "covered_by_bank"
    );
  });

  it("is not a gap when generated practice covers it", () => {
    expect(settleGap({ ownMaterial: 0, pastPaper: 0, practice: 5, ...readable })).toBe(
      "covered_by_bank"
    );
  });

  it("is a gap only when every bank answered and all were empty", () => {
    expect(settleGap({ ownMaterial: 0, pastPaper: 0, practice: 0, ...readable })).toBe("uncovered");
  });

  it("claims nothing when a bank could not be read", () => {
    // An outage must never be reported to a student as a hole in their syllabus.
    expect(
      settleGap({ ownMaterial: 0, pastPaper: 0, practice: 0, pastPaperAvailable: false, practiceAvailable: true })
    ).toBe("unknown");
    expect(
      settleGap({ ownMaterial: 0, pastPaper: 0, practice: 0, pastPaperAvailable: true, practiceAvailable: false })
    ).toBe("unknown");
  });

  it("still reports covered when a bank is unreadable but something else covers it", () => {
    // No need to have heard from everyone to know the answer is not "nothing".
    expect(
      settleGap({
        ownMaterial: MIN_COVERED_ITEMS,
        pastPaperAvailable: false,
        practiceAvailable: false,
      })
    ).toBe("covered_by_bank");
  });
});
