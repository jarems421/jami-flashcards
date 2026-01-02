export interface StarSizeConfig {
  baseStarSize: number;
  baselineGoal: number;
  minSize: number;
  maxSize: number;
  cardWeight: number;
  accuracyWeight: number;
}

const DEFAULT_CONFIG: StarSizeConfig = {
  baseStarSize: 20,
  baselineGoal: 10,
  minSize: 4,
  maxSize: 80,
  cardWeight: 0.7,
  accuracyWeight: 0.3,
};

export function calculateStarSize(
  goalTargetCount: number,
  targetAccuracy: number = 80,
  config: Partial<StarSizeConfig> = {}
): number {
  const { baselineGoal, minSize, maxSize, cardWeight, accuracyWeight } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (goalTargetCount <= 0 && targetAccuracy <= 0) {
    return minSize;
  }

  const cardScore = goalTargetCount > 0 
    ? Math.sqrt(goalTargetCount / baselineGoal)
    : 0;
  
  const accuracyScore = targetAccuracy > 0 
    ? Math.min(1.25, targetAccuracy / 80)
    : 0;

  const combinedScore = (cardScore * cardWeight) + (accuracyScore * accuracyWeight);
  
  const rawSize = minSize + (maxSize - minSize) * Math.min(1, combinedScore / 2);
  
  return Math.max(minSize, Math.min(maxSize, rawSize));
}

export function getStarSizeFromGoal(goal: {
  targetCount?: number | null;
  targetAccuracy?: number | null;
}): number {
  const targetCount = goal.targetCount || 0;
  const targetAccuracy = goal.targetAccuracy || 80;
  return calculateStarSize(targetCount, targetAccuracy);
}
