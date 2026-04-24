import { normalizeStudyTextInput } from "@/lib/study/display-text";

export const MAX_FRONT_LENGTH = 400;
export const MAX_BACK_LENGTH = 2_000;
export const MAX_CARD_TAGS = 10;
export const MAX_CARD_TAG_LENGTH = 32;
const MAX_IMPORT_ERROR_MESSAGES = 8;

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

export type ImportedCardDraft = {
  front: string;
  back: string;
};

export type CardImportParseResult = {
  cards: ImportedCardDraft[];
  errors: string[];
  skippedRows: number;
};

function normalizeTagText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function getTagKey(value: string): string {
  return normalizeTagText(value).toLowerCase();
}

function normalizeSingleTag(value: string): string {
  return normalizeTagText(value);
}

export function normalizeCardTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seenKeys = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const nextTag = normalizeSingleTag(entry);
    const nextKey = getTagKey(nextTag);
    if (!nextTag || nextTag.length > MAX_CARD_TAG_LENGTH || seenKeys.has(nextKey)) {
      continue;
    }

    seenKeys.add(nextKey);
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

function normalizeImportCell(value: string): string {
  return normalizeCardContentInput(value);
}

export function normalizeCardContentInput(value: string): string {
  return normalizeStudyTextInput(value).trim();
}

export function getCardContentKey(front: string, back: string): string {
  const frontKey = normalizeImportCell(front).replace(/\s+/g, " ").toLowerCase();
  const backKey = normalizeImportCell(back).replace(/\s+/g, " ").toLowerCase();
  return `${frontKey}\u001f${backKey}`;
}

function getImportCellKey(value: string): string {
  return normalizeImportCell(value).toLowerCase();
}

function isImportHeader(front: string, back: string): boolean {
  const frontKey = getImportCellKey(front);
  const backKey = getImportCellKey(back);

  return (
    ["front", "term", "question", "prompt"].includes(frontKey) &&
    ["back", "definition", "answer", "response"].includes(backKey)
  );
}

function parseCommaSeparatedFields(line: string): string[] | null {
  if (!line.includes(",")) {
    return null;
  }

  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (inQuotes) {
    return null;
  }

  fields.push(current);
  return fields;
}

function splitImportedCardLine(line: string): ImportedCardDraft | null {
  const tabIndex = line.indexOf("\t");
  if (tabIndex !== -1) {
    return {
      front: normalizeImportCell(line.slice(0, tabIndex)),
      back: normalizeImportCell(line.slice(tabIndex + 1)),
    };
  }

  const pipeIndex = line.indexOf("|");
  if (pipeIndex !== -1) {
    return {
      front: normalizeImportCell(line.slice(0, pipeIndex)),
      back: normalizeImportCell(line.slice(pipeIndex + 1)),
    };
  }

  const spacedDashMatch = line.match(/\s[-\u2013\u2014]\s/);
  if (spacedDashMatch?.index !== undefined) {
    const dashIndex = spacedDashMatch.index;
    const dashLength = spacedDashMatch[0].length;
    return {
      front: normalizeImportCell(line.slice(0, dashIndex)),
      back: normalizeImportCell(line.slice(dashIndex + dashLength)),
    };
  }

  const colonIndex = line.indexOf(":");
  if (colonIndex !== -1) {
    return {
      front: normalizeImportCell(line.slice(0, colonIndex)),
      back: normalizeImportCell(line.slice(colonIndex + 1)),
    };
  }

  const commaFields = parseCommaSeparatedFields(line);
  if (commaFields && commaFields.length >= 2) {
    return {
      front: normalizeImportCell(commaFields[0]),
      back: normalizeImportCell(commaFields.slice(1).join(",")),
    };
  }

  return null;
}

function pushImportError(errors: string[], message: string) {
  if (errors.length < MAX_IMPORT_ERROR_MESSAGES) {
    errors.push(message);
  }
}

function getImportFormatHelp(lineNumber: number) {
  return `Line ${lineNumber}: use Question | Answer, Question - Answer, Question: Answer, or put the answer on the next line.`;
}

function addImportedCardDraft(
  cards: ImportedCardDraft[],
  errors: string[],
  draft: ImportedCardDraft,
  lineNumber: number,
  isFirstContent: boolean
) {
  if (isFirstContent && isImportHeader(draft.front, draft.back)) {
    return { skippedRows: 0, skippedHeader: true };
  }

  if (!draft.front || !draft.back) {
    pushImportError(errors, `Line ${lineNumber}: question and answer are required.`);
    return { skippedRows: 1, skippedHeader: false };
  }

  if (draft.front.length > MAX_FRONT_LENGTH) {
    pushImportError(
      errors,
      `Line ${lineNumber}: question must be ${MAX_FRONT_LENGTH} characters or less.`
    );
    return { skippedRows: 1, skippedHeader: false };
  }

  if (draft.back.length > MAX_BACK_LENGTH) {
    pushImportError(
      errors,
      `Line ${lineNumber}: answer must be ${MAX_BACK_LENGTH} characters or less.`
    );
    return { skippedRows: 1, skippedHeader: false };
  }

  cards.push(draft);
  return { skippedRows: 0, skippedHeader: false };
}

export function parseCardImportText(value: string): CardImportParseResult {
  const cards: ImportedCardDraft[] = [];
  const errors: string[] = [];
  let skippedRows = 0;
  let isFirstContent = true;
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const commitDraft = (draft: ImportedCardDraft, lineNumber: number) => {
    const result = addImportedCardDraft(
      cards,
      errors,
      draft,
      lineNumber,
      isFirstContent
    );
    skippedRows += result.skippedRows;
    isFirstContent = false;
  };

  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const block: Array<{ line: string; lineNumber: number }> = [];
    while (index < lines.length && lines[index].trim()) {
      block.push({ line: lines[index], lineNumber: index + 1 });
      index += 1;
    }

    const parsedLines = block.map((entry) => ({
      ...entry,
      parsed: splitImportedCardLine(entry.line),
    }));
    const hasLineDelimitedCards = parsedLines.some((entry) => entry.parsed !== null);

    if (hasLineDelimitedCards) {
      for (const entry of parsedLines) {
        if (!entry.parsed) {
          skippedRows += 1;
          pushImportError(errors, getImportFormatHelp(entry.lineNumber));
          isFirstContent = false;
          continue;
        }

        commitDraft(entry.parsed, entry.lineNumber);
      }
      continue;
    }

    if (block.length === 1) {
      skippedRows += 1;
      pushImportError(errors, getImportFormatHelp(block[0].lineNumber));
      isFirstContent = false;
      continue;
    }

    if (block.length === 2) {
      commitDraft(
        {
          front: normalizeImportCell(block[0].line),
          back: normalizeImportCell(block[1].line),
        },
        block[0].lineNumber
      );
      continue;
    }

    if (block.length % 2 === 0) {
      for (let pairIndex = 0; pairIndex < block.length; pairIndex += 2) {
        commitDraft(
          {
            front: normalizeImportCell(block[pairIndex].line),
            back: normalizeImportCell(block[pairIndex + 1].line),
          },
          block[pairIndex].lineNumber
        );
      }
      continue;
    }

    skippedRows += 1;
    pushImportError(
      errors,
      `Line ${block[0].lineNumber}: this block has an extra question or answer line. Add a blank line between cards or use Question | Answer.`
    );
    isFirstContent = false;
  }

  if (skippedRows > errors.length) {
    errors.push(`${skippedRows - errors.length} more rows need attention.`);
  }

  return {
    cards,
    errors,
    skippedRows,
  };
}

function normalizeExportCell(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\t\n]+/g, " ").trim();
}

function csvEscape(value: string): string {
  const normalized = normalizeExportCell(value);
  if (!/[",\n]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

export function exportCardsToSeparatedText(
  cards: Array<Pick<Card, "front" | "back">>,
  format: "tsv" | "csv" = "tsv"
) {
  const header = format === "csv" ? "Front,Back" : "Front\tBack";
  const rows = cards.map((card) => {
    if (format === "csv") {
      return `${csvEscape(card.front)},${csvEscape(card.back)}`;
    }

    return `${normalizeExportCell(card.front)}\t${normalizeExportCell(card.back)}`;
  });

  return [header, ...rows].join("\n");
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

  const nextTagKey = getTagKey(nextTag);
  if (normalizedTags.some((tag) => getTagKey(tag) === nextTagKey)) {
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
  const nextTagKey = getTagKey(value);
  if (!nextTagKey) {
    return normalizeCardTags(tags);
  }

  return normalizeCardTags(
    tags.filter((tag) => getTagKey(tag) !== nextTagKey)
  );
}

export function getTagSuggestions(
  availableTags: string[],
  value: string,
  selectedTags: string[],
  limit = 8
): string[] {
  const queryKey = getTagKey(value);
  const selected = new Set(normalizeCardTags(selectedTags).map(getTagKey));

  return normalizeCardTags(availableTags)
    .filter((tag) => {
      const key = getTagKey(tag);
      return !selected.has(key) && (!queryKey || key.includes(queryKey));
    })
    .sort((left, right) => {
      const leftStartsWith = queryKey ? getTagKey(left).startsWith(queryKey) : false;
      const rightStartsWith = queryKey ? getTagKey(right).startsWith(queryKey) : false;

      if (leftStartsWith !== rightStartsWith) {
        return leftStartsWith ? -1 : 1;
      }

      return left.localeCompare(right);
    })
    .slice(0, limit);
}

export function getCardTagsInputError(value: string): string | null {
  const seenKeys = new Set<string>();

  for (const rawTag of value.split(",")) {
    const normalized = normalizeSingleTag(rawTag);
    if (!normalized) {
      continue;
    }

    if (normalized.length > MAX_CARD_TAG_LENGTH) {
      return `Each tag must be ${MAX_CARD_TAG_LENGTH} characters or less.`;
    }

    seenKeys.add(getTagKey(normalized));
    if (seenKeys.size > MAX_CARD_TAGS) {
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

  const allowedTags = new Set(normalizeCardTags(selectedTags).map(getTagKey));
  if (allowedTags.size === 0) {
    return true;
  }

  return card.tags.some((tag) => allowedTags.has(getTagKey(tag)));
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
