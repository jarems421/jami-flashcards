import type { CardStudySettings, ExerciseVerdict } from "@/lib/study/study-modes";

/**
 * What kind of answer we are looking at, which decides how hard the marker is
 * allowed to be.
 *
 * The distinction that matters is `prose` against everything else. A short
 * factual answer that does not match is wrong. A paragraph that does not match
 * may be a perfectly good paraphrase, and no amount of string comparison will
 * tell the difference -- so prose is never marked wrong here, only handed back
 * to the student (and later, to a semantic check).
 */
export type AnswerShape = "numeric" | "list" | "short" | "prose";

export type MarkedAnswer = {
  verdict: ExerciseVerdict;
  shape: AnswerShape;
  /** Set when a list was partly right, so feedback can say which parts landed. */
  matchedItems?: string[];
  missingItems?: string[];
  /** Set when the value was right but the unit was missing or wrong. */
  unitMismatch?: boolean;
};

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
/**
 * A slash only separates a list when it is spaced: "red / blue" is two items,
 * "9.8 m/s" is one value with a unit. Getting this wrong sent every compound
 * unit down the list marker and it never reached the numeric one.
 */
const LIST_SEPARATOR = /\s*(?:,|;|\n|•)\s*|\s+\/\s+/;
const SHORT_ANSWER_WORD_LIMIT = 6;
const LIST_ITEM_WORD_LIMIT = 5;
const MAX_TYPO_EDITS = 3;
const CHARACTERS_PER_ALLOWED_EDIT = 6;

/**
 * The comparison form: the same answer typed by two people should reach this
 * looking identical, without erasing anything that changes the meaning.
 *
 * Case, spacing, smart quotes, a leading article and a trailing full stop all
 * go. Accents and internal punctuation stay, because "resume" is not "resumé"
 * and "1,5" is not "15" -- those are handled a tier down as `close`.
 */
export function normalizeAnswerText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(LEADING_ARTICLE, "")
    .replace(/[.!]+$/, "")
    .trim();
}

/** Normalization plus accents and punctuation, for the "nearly" tier. */
export function looseNormalizeAnswerText(value: string) {
  return normalizeAnswerText(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function parseNumericAnswer(value: string) {
  const normalized = normalizeAnswerText(value).replace(/,(?=\d{3}\b)/g, "");
  const match = /^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.*)$/i.exec(normalized);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return { value: parsed, unit: match[2].trim() };
}

export function parseListAnswer(value: string) {
  const items = normalizeAnswerText(value)
    .split(LIST_SEPARATOR)
    .map((item) => item.replace(LEADING_ARTICLE, "").trim())
    .filter(Boolean);
  if (items.length < 2) return null;
  if (items.some((item) => wordCount(item) > LIST_ITEM_WORD_LIMIT)) return null;
  return items;
}

export function classifyAnswerShape(answer: string): AnswerShape {
  const normalized = normalizeAnswerText(answer);
  if (!normalized) return "short";
  if (parseListAnswer(answer)) return "list";
  const numeric = parseNumericAnswer(answer);
  if (numeric && wordCount(numeric.unit) <= 2) return "numeric";
  return wordCount(normalized) <= SHORT_ANSWER_WORD_LIMIT ? "short" : "prose";
}

/** Levenshtein distance, capped: we only ever ask "is this within N edits?". */
export function editDistance(left: string, right: string, limit: number) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function allowedTypoEdits(length: number) {
  if (length < 5) return 0;
  return Math.min(MAX_TYPO_EDITS, Math.max(1, Math.floor(length / CHARACTERS_PER_ALLOWED_EDIT)));
}

function acceptedForms(expectedAnswer: string, settings?: CardStudySettings) {
  const forms = [expectedAnswer, ...(settings?.acceptedAnswers ?? [])];
  return forms.map((form) => form ?? "").filter((form) => form.trim().length > 0);
}

function markNumeric(
  response: string,
  expected: string,
  settings?: CardStudySettings
): MarkedAnswer | null {
  const expectedNumber = parseNumericAnswer(expected);
  if (!expectedNumber) return null;
  const responseNumber = parseNumericAnswer(response);
  if (!responseNumber) {
    return { verdict: "incorrect", shape: "numeric" };
  }

  const tolerance = Math.abs(settings?.numericTolerance ?? 0);
  const withinTolerance =
    Math.abs(responseNumber.value - expectedNumber.value) <= tolerance;
  if (!withinTolerance) {
    return { verdict: "incorrect", shape: "numeric" };
  }

  const unitsMatch =
    looseNormalizeAnswerText(responseNumber.unit) ===
    looseNormalizeAnswerText(expectedNumber.unit);
  if (settings?.requireUnits && !unitsMatch) {
    return { verdict: "partial", shape: "numeric", unitMismatch: true };
  }
  return {
    verdict: unitsMatch ? "correct" : "close",
    shape: "numeric",
    ...(unitsMatch ? {} : { unitMismatch: true }),
  };
}

function markList(
  response: string,
  expected: string,
  settings?: CardStudySettings
): MarkedAnswer | null {
  const expectedItems = parseListAnswer(expected);
  if (!expectedItems) return null;
  const responseItems = parseListAnswer(response) ?? [
    normalizeAnswerText(response),
  ].filter(Boolean);

  const remaining = [...responseItems];
  const matched: string[] = [];
  const missing: string[] = [];
  for (const item of expectedItems) {
    const position = remaining.findIndex(
      (candidate) =>
        candidate === item ||
        looseNormalizeAnswerText(candidate) === looseNormalizeAnswerText(item)
    );
    if (position >= 0) {
      matched.push(item);
      remaining.splice(position, 1);
    } else {
      missing.push(item);
    }
  }

  if (matched.length === 0) {
    return { verdict: "incorrect", shape: "list", matchedItems: [], missingItems: missing };
  }
  if (missing.length > 0 || remaining.length > 0) {
    return {
      verdict: "partial",
      shape: "list",
      matchedItems: matched,
      missingItems: missing,
    };
  }

  // Everything is present. Order only counts when the author asked for it.
  const orderMatters = settings?.listOrder === "fixed";
  const inOrder = expectedItems.every((item, index) => responseItems[index] === item);
  return {
    verdict: orderMatters && !inOrder ? "partial" : "correct",
    shape: "list",
    matchedItems: matched,
    missingItems: [],
  };
}

/**
 * Mark a typed answer without asking anything of a model.
 *
 * The verdict feeds `resolveAttemptOutcome`, which decides whether it is worth
 * committing. Note what this deliberately never returns: `incorrect` for a
 * prose answer. A wrong-looking paragraph may be a correct paraphrase, and
 * pretending otherwise would schedule cards on the strength of a string
 * comparison.
 */
export function markTypedAnswer(input: {
  response: string;
  expectedAnswer: string;
  settings?: CardStudySettings;
}): MarkedAnswer {
  const shape = classifyAnswerShape(input.expectedAnswer);
  const response = input.response ?? "";
  if (!response.trim()) {
    return { verdict: "incorrect", shape };
  }

  const forms = acceptedForms(input.expectedAnswer, input.settings);
  const normalizedResponse = normalizeAnswerText(response);

  for (const form of forms) {
    if (normalizeAnswerText(form) === normalizedResponse) {
      return { verdict: "correct", shape };
    }
  }

  for (const form of forms) {
    if (shape === "numeric") {
      const numeric = markNumeric(response, form, input.settings);
      if (numeric && numeric.verdict !== "incorrect") return numeric;
    }
    if (shape === "list") {
      const list = markList(response, form, input.settings);
      if (list && list.verdict !== "incorrect") return list;
    }
  }

  // Numbers leave here without meeting the forgiving tiers below. A digit out
  // of place is not a typo and 9.8 is not 98, so neither dropping punctuation
  // nor allowing an edit may ever turn one value into another.
  if (shape === "numeric") {
    return markNumeric(response, input.expectedAnswer, input.settings) ?? {
      verdict: "incorrect",
      shape,
    };
  }

  const looseResponse = looseNormalizeAnswerText(response);
  for (const form of forms) {
    if (looseResponse && looseNormalizeAnswerText(form) === looseResponse) {
      return { verdict: "close", shape };
    }
  }

  // Typo tolerance is for words. A list marks its items individually, and prose
  // is never called wrong in the first place.
  if (shape === "short") {
    for (const form of forms) {
      const target = looseNormalizeAnswerText(form);
      const limit = allowedTypoEdits(target.length);
      if (limit > 0 && editDistance(looseResponse, target, limit) <= limit) {
        return { verdict: "close", shape };
      }
    }
  }

  if (shape === "list") {
    return markList(response, input.expectedAnswer, input.settings) ?? {
      verdict: "incorrect",
      shape,
    };
  }

  // Short factual answers are safe to call wrong. Prose is not: it goes back to
  // the student, and in a later step to a semantic check.
  return { verdict: shape === "prose" ? "needs-self-grade" : "incorrect", shape };
}
