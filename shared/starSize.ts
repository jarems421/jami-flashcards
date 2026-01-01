export interface StarSizeConfig {
  baseStarSize: number;
  baselineGoal: number;
  minSize: number;
  maxSize: number;
}

const DEFAULT_CONFIG: StarSizeConfig = {
  baseStarSize: 32,
  baselineGoal: 10,
  minSize: 16,
  maxSize: 80,
};

export function calculateStarSize(
  goalTargetCount: number,
  config: Partial<StarSizeConfig> = {}
): number {
  const { baseStarSize, baselineGoal, minSize, maxSize } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (goalTargetCount <= 0 || baselineGoal <= 0) {
    return baseStarSize;
  }

  const scale = goalTargetCount / baselineGoal;
  const rawSize = baseStarSize * scale;
  return Math.max(minSize, Math.min(maxSize, rawSize));
}

export function calculateAccuracyStarSize(
  targetAccuracy: number,
  config: Partial<StarSizeConfig> = {}
): number {
  const baselineAccuracy = 80;
  const { baseStarSize, minSize, maxSize } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (targetAccuracy <= 0) {
    return baseStarSize;
  }

  const scale = targetAccuracy / baselineAccuracy;
  const rawSize = baseStarSize * scale;
  return Math.max(minSize, Math.min(maxSize, rawSize));
}

export function getStarSizeFromGoal(goal: {
  targetCount?: number | null;
  targetAccuracy?: number | null;
}): number {
  if (goal.targetCount && goal.targetCount > 0) {
    return calculateStarSize(goal.targetCount);
  }
  if (goal.targetAccuracy && goal.targetAccuracy > 0) {
    return calculateAccuracyStarSize(goal.targetAccuracy);
  }
  return DEFAULT_CONFIG.baseStarSize;
}
