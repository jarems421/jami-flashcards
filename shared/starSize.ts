export interface StarSizeConfig {
  minSize: number;
  maxSize: number;
  minCards: number;
  maxCards: number;
}

const DEFAULT_CONFIG: StarSizeConfig = {
  minSize: 8,
  maxSize: 50,
  minCards: 10,
  maxCards: 10000,
};

export function calculateStarSize(
  goalTargetCount: number,
  targetAccuracy: number = 80,
  config: Partial<StarSizeConfig> = {}
): number {
  const { minSize, maxSize, minCards, maxCards } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  if (goalTargetCount <= 0) {
    return minSize;
  }

  const clampedCards = Math.max(minCards, Math.min(maxCards, goalTargetCount));
  
  const logMin = Math.log(minCards);
  const logMax = Math.log(maxCards);
  const logCurrent = Math.log(clampedCards);
  
  let t = (logCurrent - logMin) / (logMax - logMin);
  
  t = 0.15 + (t * 0.85);
  
  const accuracyBonus = targetAccuracy > 80 ? (targetAccuracy - 80) / 100 : 0;
  t = Math.min(1, t + (accuracyBonus * 0.05));
  
  const size = minSize + (maxSize - minSize) * t;
  
  return Math.max(minSize, Math.min(maxSize, size));
}

export function getStarSizeFromGoal(goal: {
  targetCount?: number | null;
  targetAccuracy?: number | null;
}): number {
  const targetCount = goal.targetCount || 10;
  const targetAccuracy = goal.targetAccuracy || 80;
  return calculateStarSize(targetCount, targetAccuracy);
}

export type StarRarityType = 'NORMAL' | 'BRIGHT' | 'BRILLIANT';

export function getStarDisplayName(rarity: StarRarityType): string {
  switch (rarity) {
    case 'BRILLIANT':
      return 'Diamond';
    case 'BRIGHT':
      return 'Topaz';
    case 'NORMAL':
    default:
      return 'Quartz';
  }
}

export function getNextStarRarity(currentStarCount: number): { rarity: StarRarityType; displayName: string } {
  const nextIndex = currentStarCount + 1;
  let rarity: StarRarityType = 'NORMAL';
  
  if (nextIndex % 25 === 0) {
    rarity = 'BRILLIANT';
  } else if (nextIndex % 10 === 0) {
    rarity = 'BRIGHT';
  }
  
  return {
    rarity,
    displayName: getStarDisplayName(rarity)
  };
}
