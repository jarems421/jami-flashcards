import { describe, expect, it } from "vitest";
import { chooseStudyNextStep } from "@/lib/study/session-next-step";

const nothingLeft = {
  sessionWasCarryoverOnly: false,
  remainingFreshRequired: 0,
  remainingOptional: 0,
  focusedCardCount: 0,
  completedGoals: 0,
};

describe("chooseStudyNextStep", () => {
  it("sends a cleared carryover straight on to today's cards", () => {
    expect(
      chooseStudyNextStep({
        ...nothingLeft,
        sessionKind: "daily-required",
        sessionWasCarryoverOnly: true,
        remainingFreshRequired: 4,
        remainingOptional: 3,
        focusedCardCount: 10,
      })
    ).toEqual({ message: "fresh-required-ready", action: "start-fresh-required" });
  });

  it("offers easy extras only after a required Daily Review", () => {
    expect(
      chooseStudyNextStep({ ...nothingLeft, sessionKind: "daily-required", remainingOptional: 2 })
    ).toEqual({ message: "optional-ready", action: "start-optional" });
    expect(
      chooseStudyNextStep({ ...nothingLeft, sessionKind: "custom", remainingOptional: 2 })
    ).toEqual({ message: "tidy-cards", action: "edit-cards" });
  });

  it("does not offer today's cards when the session was more than carryover", () => {
    expect(
      chooseStudyNextStep({
        ...nothingLeft,
        sessionKind: "daily-required",
        remainingFreshRequired: 4,
        focusedCardCount: 6,
      })
    ).toEqual({ message: "focused-ready", action: "start-focused" });
  });

  it("names a cleared Simple Study but lets its button fall through", () => {
    expect(
      chooseStudyNextStep({ ...nothingLeft, sessionKind: "simple", focusedCardCount: 6 })
    ).toEqual({ message: "simple-clear", action: "start-focused" });
    expect(
      chooseStudyNextStep({ ...nothingLeft, sessionKind: "simple", completedGoals: 1 })
    ).toEqual({ message: "simple-clear", action: "view-constellation" });
  });

  it("points at a new star, then at tidying cards, when nothing else is ready", () => {
    expect(
      chooseStudyNextStep({ ...nothingLeft, sessionKind: "daily-optional", completedGoals: 1 })
    ).toEqual({ message: "new-star", action: "view-constellation" });
    expect(chooseStudyNextStep({ ...nothingLeft, sessionKind: "daily-optional" })).toEqual({
      message: "tidy-cards",
      action: "edit-cards",
    });
  });
});
