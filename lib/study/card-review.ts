import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import type {
  CardReviewCounterUpdates,
  CardReviewUpdateCommand,
  CardReviewValueUpdates,
} from "@/lib/study/cards";

export function buildCardReviewUpdateCommand(input: {
  schedule: CardReviewValueUpdates | null;
  isCorrect: boolean;
  isStruggle: boolean;
  reviewedAt: number;
}): CardReviewUpdateCommand {
  const values: CardReviewValueUpdates = {
    ...(input.schedule ?? {}),
  };
  const increments: CardReviewCounterUpdates = {};

  if (!input.schedule && input.isStruggle) {
    const studyDayKey = getStudyDayKey(input.reviewedAt);
    values.lastStruggleAt = input.reviewedAt;
    values.lastStruggleStudyDayKey = studyDayKey;
    values.memoryRiskOverrideDayKey = shiftStudyDayKey(studyDayKey, 1);
    increments.customStruggleCount = 1;
  }

  if (input.isStruggle) {
    values.simpleStudyLastResult = "wrong";
    values.simpleStudyLastReviewedAt = input.reviewedAt;
    increments.simpleStudyWrongCount = 1;
  }

  return {
    values,
    increments,
    clearMemoryRiskOverrideDayKey: Boolean(
      input.schedule && input.isCorrect
    ),
  };
}

export function hasCardReviewUpdateCommand(
  command: CardReviewUpdateCommand
) {
  return Boolean(
    command.clearMemoryRiskOverrideDayKey ||
      Object.keys(command.values ?? {}).length > 0 ||
      Object.keys(command.increments ?? {}).length > 0
  );
}
