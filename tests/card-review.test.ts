import { describe, expect, it } from "vitest";
import {
  buildCardReviewUpdateCommand,
  hasCardReviewUpdateCommand,
} from "@/lib/study/card-review";

const REVIEWED_AT = Date.parse("2026-07-29T12:00:00.000Z");

describe("card review persistence commands", () => {
  it("writes a successful schedule and clears a previous memory-risk override", () => {
    const command = buildCardReviewUpdateCommand({
      schedule: {
        reps: 4,
        dueDate: REVIEWED_AT + 86_400_000,
      },
      isCorrect: true,
      isStruggle: false,
      reviewedAt: REVIEWED_AT,
    });

    expect(command).toEqual({
      values: {
        reps: 4,
        dueDate: REVIEWED_AT + 86_400_000,
      },
      increments: {},
      clearMemoryRiskOverrideDayKey: true,
    });
    expect(hasCardReviewUpdateCommand(command)).toBe(true);
  });

  it("adds Simple Study struggle evidence to a difficult scheduled review", () => {
    const command = buildCardReviewUpdateCommand({
      schedule: {
        reps: 2,
        lapses: 1,
      },
      isCorrect: false,
      isStruggle: true,
      reviewedAt: REVIEWED_AT,
    });

    expect(command).toEqual({
      values: {
        reps: 2,
        lapses: 1,
        simpleStudyLastResult: "wrong",
        simpleStudyLastReviewedAt: REVIEWED_AT,
      },
      increments: {
        simpleStudyWrongCount: 1,
      },
      clearMemoryRiskOverrideDayKey: false,
    });
  });

  it("records both custom-review and Simple Study struggle evidence", () => {
    const command = buildCardReviewUpdateCommand({
      schedule: null,
      isCorrect: false,
      isStruggle: true,
      reviewedAt: REVIEWED_AT,
    });

    expect(command.values).toMatchObject({
      lastStruggleAt: REVIEWED_AT,
      simpleStudyLastResult: "wrong",
      simpleStudyLastReviewedAt: REVIEWED_AT,
    });
    expect(command.values?.lastStruggleStudyDayKey).toEqual(
      expect.any(String)
    );
    expect(command.values?.memoryRiskOverrideDayKey).toEqual(
      expect.any(String)
    );
    expect(command.increments).toEqual({
      customStruggleCount: 1,
      simpleStudyWrongCount: 1,
    });
    expect(hasCardReviewUpdateCommand(command)).toBe(true);
  });

  it("keeps a successful custom review as a card-write no-op", () => {
    const command = buildCardReviewUpdateCommand({
      schedule: null,
      isCorrect: true,
      isStruggle: false,
      reviewedAt: REVIEWED_AT,
    });

    expect(command).toEqual({
      values: {},
      increments: {},
      clearMemoryRiskOverrideDayKey: false,
    });
    expect(hasCardReviewUpdateCommand(command)).toBe(false);
  });
});
