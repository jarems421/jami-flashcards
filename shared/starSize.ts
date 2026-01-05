export interface StarSizeConfig {
  minSize: number;
  maxSize: number;
  minCards: number;
  maxCards: number;
}

const DEFAULT_CONFIG: StarSizeConfig = {
  minSize: 12,
  maxSize: 70,
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
  
  let t: number;
  
  if (clampedCards < 1000) {
    // Below 1000 cards: smaller stars (0-35% of size range)
    const logMin = Math.log(minCards);
    const logMid = Math.log(1000);
    const logCurrent = Math.log(clampedCards);
    const progress = (logCurrent - logMin) / (logMid - logMin);
    t = progress * 0.35;
  } else {
    // 1000+ cards: larger stars (35-100% of size range)
    const logMid = Math.log(1000);
    const logMax = Math.log(maxCards);
    const logCurrent = Math.log(clampedCards);
    const progress = (logCurrent - logMid) / (logMax - logMid);
    t = 0.35 + (progress * 0.65);
  }
  
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
      return 'Transcendent';
    case 'BRIGHT':
      return 'Ascended';
    case 'NORMAL':
    default:
      return 'Star';
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

export function getStarSizeLabel(size: number): string {
  const { minSize, maxSize } = DEFAULT_CONFIG;
  const percent = Math.round(((size - minSize) / (maxSize - minSize)) * 100);
  
  if (percent <= 20) return 'Tiny';
  if (percent <= 40) return 'Small';
  if (percent <= 60) return 'Medium';
  if (percent <= 80) return 'Large';
  return 'Brilliant';
}
