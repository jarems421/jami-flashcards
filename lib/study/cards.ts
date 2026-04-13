export const MAX_FRONT_LENGTH = 400;
export const MAX_BACK_LENGTH = 2_000;
export const MAX_CARD_TAGS = 10;
export const MAX_CARD_TAG_LENGTH = 32;

export type Card = {
  id: string;
  deckId: string;
  userId: string;
  front: string;
  back: string;
  createdAt: number;
  tags: string[];
  // Legacy SM-2 fields (kept for backward compat)
  interval?: number;
  repetitions?: number;
  easeFactor?: number;
  dueDate?: number;
  // FSRS fields
  stability?: number;
  difficulty?: number;
  fsrsState?: number; // 0=New, 1=Learning, 2=Review, 3=Relearning
  lapses?: number;
  reps?: number;
  lastReview?: number; // epoch ms
  scheduledDays?: number;
  elapsedDays?: number;
  lastStruggleAt?: number;
  lastStruggleStudyDayKey?: string;
  memoryRiskOverrideDayKey?: string;
  customStruggleCount?: number;
};

function normalizeSingleTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeCardTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const nextTag = normalizeSingleTag(entry);
    if (!nextTag || nextTag.length > MAX_CARD_TAG_LENGTH || seen.has(nextTag)) {
      continue;
    }

    seen.add(nextTag);
    normalized.push(nextTag);

    if (normalized.length >= MAX_CARD_TAGS) {
      break;
    }
  }

  return normalized;
}

export function parseCardTagsInput(value: string): string[] {
  return normalizeCardTags(value.split(","));
}

export function parseCardTagsParam(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return parseCardTagsInput(value);
}

export function addCardTag(
  tags: string[],
  value: string
): { nextTags: string[]; added: boolean; error: string | null } {
  const normalizedTags = normalizeCardTags(tags);
  const nextTag = normalizeSingleTag(value);

  if (!nextTag) {
    return {
      nextTags: normalizedTags,
      added: false,
      error: null,
    };
  }

  if (nextTag.length > MAX_CARD_TAG_LENGTH) {
    return {
      nextTags: normalizedTags,
      added: false,
      error: `Each tag must be ${MAX_CARD_TAG_LENGTH} characters or less.`,
    };
  }

  if (normalizedTags.includes(nextTag)) {
    return {
      nextTags: normalizedTags,
      added: false,
      error: null,
    };
  }

  if (normalizedTags.length >= MAX_CARD_TAGS) {
    return {
      nextTags: normalizedTags,
      added: false,
      error: `Use up to ${MAX_CARD_TAGS} tags per card.`,
    };
  }

  return {
    nextTags: [...normalizedTags, nextTag],
    added: true,
    error: null,
  };
}

export function removeCardTag(tags: string[], value: string): string[] {
  const nextTag = normalizeSingleTag(value);
  if (!nextTag) {
    return normalizeCardTags(tags);
  }

  return normalizeCardTags(tags.filter((tag) => tag !== nextTag));
}

export function getTagSuggestions(
  availableTags: string[],
  value: string,
  selectedTags: string[],
  limit = 8
): string[] {
  const query = normalizeSingleTag(value);
  const selected = new Set(normalizeCardTags(selectedTags));

  return normalizeCardTags(availableTags)
    .filter((tag) => !selected.has(tag) && (!query || tag.includes(query)))
    .sort((left, right) => {
      const leftStartsWith = query ? left.startsWith(query) : false;
      const rightStartsWith = query ? right.startsWith(query) : false;

      if (leftStartsWith !== rightStartsWith) {
        return leftStartsWith ? -1 : 1;
      }

      return left.localeCompare(right);
    })
    .slice(0, limit);
}

export function getCardTagsInputError(value: string): string | null {
  const seen = new Set<string>();

  for (const rawTag of value.split(",")) {
    const normalized = normalizeSingleTag(rawTag);
    if (!normalized) {
      continue;
    }

    if (normalized.length > MAX_CARD_TAG_LENGTH) {
      return `Each tag must be ${MAX_CARD_TAG_LENGTH} characters or less.`;
    }

    seen.add(normalized);
    if (seen.size > MAX_CARD_TAGS) {
      return `Use up to ${MAX_CARD_TAGS} tags per card.`;
    }
  }

  return null;
}

export function cardMatchesAnyTag(
  card: Pick<Card, "tags">,
  selectedTags: string[]
): boolean {
  if (selectedTags.length === 0) {
    return true;
  }

  const allowedTags = new Set(normalizeCardTags(selectedTags));
  if (allowedTags.size === 0) {
    return true;
  }

  return card.tags.some((tag) => allowedTags.has(tag));
}

export function mapCardData(id: string, data: Record<string, unknown>): Card {
  return {
    id,
    deckId: typeof data.deckId === "string" ? data.deckId : "",
    userId:
      typeof data.userId === "string"
        ? data.userId
        : typeof data.uid === "string"
          ? data.uid
          : "",
    front: typeof data.front === "string" ? data.front : "",
    back: typeof data.back === "string" ? data.back : "",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    tags: normalizeCardTags(data.tags),
    interval: typeof data.interval === "number" ? data.interval : undefined,
    repetitions: typeof data.repetitions === "number" ? data.repetitions : undefined,
    easeFactor: typeof data.easeFactor === "number" ? data.easeFactor : undefined,
    dueDate: typeof data.dueDate === "number" ? data.dueDate : undefined,
    stability: typeof data.stability === "number" ? data.stability : undefined,
    difficulty: typeof data.difficulty === "number" ? data.difficulty : undefined,
    fsrsState: typeof data.fsrsState === "number" ? data.fsrsState : undefined,
    lapses: typeof data.lapses === "number" ? data.lapses : undefined,
    reps: typeof data.reps === "number" ? data.reps : undefined,
    lastReview: typeof data.lastReview === "number" ? data.lastReview : undefined,
    scheduledDays: typeof data.scheduledDays === "number" ? data.scheduledDays : undefined,
    elapsedDays: typeof data.elapsedDays === "number" ? data.elapsedDays : undefined,
    lastStruggleAt: typeof data.lastStruggleAt === "number" ? data.lastStruggleAt : undefined,
    lastStruggleStudyDayKey:
      typeof data.lastStruggleStudyDayKey === "string"
        ? data.lastStruggleStudyDayKey
        : undefined,
    memoryRiskOverrideDayKey:
      typeof data.memoryRiskOverrideDayKey === "string"
        ? data.memoryRiskOverrideDayKey
        : undefined,
    customStruggleCount:
      typeof data.customStruggleCount === "number"
        ? data.customStruggleCount
        : undefined,
  };
}
