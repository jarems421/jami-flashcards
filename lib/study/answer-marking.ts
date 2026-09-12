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
  feedback?: string;
  evaluationSource?: "deterministic" | "semantic" | "fallback";
  assistanceUsed?: boolean;
  gapResults?: Array<{ gapId: string; verdict: ExerciseVerdict; feedback?: string }>;
};

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
/**
 * A slash only separates a list when it is spaced: "red / blue" is two items,
 * "9.8 m/s" is one value with a unit. Getting this wrong sent every compound
 * unit down the list marker and it never reached the numeric one.
 */
const LIST_SEPARATOR = /\s*(?:,|;|\n|\u2022)\s*|\s+\/\s+/;
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
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function parseNumericAnswer(value: string) {
  const normalized = value.normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the\s+)?(?:answer|speed|value|result|distance|time|mass|force)\s+(?:is|=)\s+/i, "")
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (/[;,]/.test(normalized)) return null;
  const fraction = /^([+-]?\d+(?:\.\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?)\s*(.*)$/i.exec(normalized);
  if (fraction) {
    const denominator = Number(fraction[2]);
    const parsed = Number(fraction[1]) / denominator;
    if (!Number.isFinite(parsed) || denominator === 0) return null;
    return { value: parsed, unit: fraction[3].trim() };
  }
  const match = /^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.*)$/i.exec(normalized);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return { value: parsed, unit: match[2].trim() };
}

const UNIT_SCALE: Record<string, { dimension: string; scale: number }> = {
  m: { dimension: "length", scale: 1 }, cm: { dimension: "length", scale: 0.01 }, mm: { dimension: "length", scale: 0.001 }, km: { dimension: "length", scale: 1000 },
  g: { dimension: "mass", scale: 0.001 }, kg: { dimension: "mass", scale: 1 },
  s: { dimension: "time", scale: 1 }, ms: { dimension: "time", scale: 0.001 }, min: { dimension: "time", scale: 60 }, h: { dimension: "time", scale: 3600 },
  "m/s": { dimension: "speed", scale: 1 }, "km/h": { dimension: "speed", scale: 1 / 3.6 },
};

function comparableQuantity(value: { value: number; unit: string }) {
  const unit = value.unit.normalize("NFKC").replace(/\s+/g, "");
  const known = UNIT_SCALE[unit];
  return known ? { value: value.value * known.scale, dimension: known.dimension, known: true } : { value: value.value, dimension: unit, known: false };
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
  const numeric = parseNumericAnswer(answer);
  if (numeric && wordCount(numeric.unit) <= 2) return "numeric";
  if (parseListAnswer(answer)) return "list";
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
    return { verdict: "needs-self-grade", shape: "numeric" };
  }
  if (/[a-zA-Z]/.test(responseNumber.unit) && /\s/.test(responseNumber.unit) && !UNIT_SCALE[responseNumber.unit.replace(/\s+/g, "")]) {
    return { verdict: "needs-self-grade", shape: "numeric" };
  }

  const tolerance = Math.abs(settings?.numericTolerance ?? 0);
  const responseQuantity = comparableQuantity(responseNumber);
  const expectedQuantity = comparableQuantity(expectedNumber);
  const convertible = responseQuantity.dimension === expectedQuantity.dimension && (responseQuantity.known || responseNumber.unit === expectedNumber.unit);
  const expectedScale = UNIT_SCALE[expectedNumber.unit.replace(/\s+/g, "")]?.scale ?? 1;
  const effectiveTolerance = Math.max(tolerance * (responseNumber.unit ? expectedScale : 1), Math.abs(expectedQuantity.value) * Number.EPSILON * 8, Number.EPSILON);
  const comparableValue = !responseNumber.unit && expectedNumber.unit
    ? responseNumber.value
    : responseQuantity.value;
  const targetValue = !responseNumber.unit && expectedNumber.unit
    ? expectedNumber.value
    : expectedQuantity.value;
  const withinTolerance = (!responseNumber.unit || convertible) &&
    Math.abs(comparableValue - targetValue) <= effectiveTolerance;
  if (!withinTolerance) {
    return { verdict: "incorrect", shape: "numeric" };
  }

  const expectedHasUnit = Boolean(expectedNumber.unit);
  const responseHasUnit = Boolean(responseNumber.unit);
  const unitsMatch = convertible;
  if (responseHasUnit && !unitsMatch) {
    return { verdict: "incorrect", shape: "numeric", unitMismatch: true };
  }
  const requireUnits = settings?.requireUnits ?? expectedHasUnit;
  if (requireUnits && !responseHasUnit) {
    return { verdict: "partial", shape: "numeric", unitMismatch: true };
  }
  if (!requireUnits && !responseHasUnit) {
    return { verdict: "correct", shape: "numeric" };
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
      (candidate) => candidate === item
    );
    if (position >= 0) {
      matched.push(item);
      remaining.splice(position, 1);
    } else {
      missing.push(item);
    }
  }

  if (matched.length === 0) {
    return { verdict: "needs-self-grade", shape: "list", matchedItems: [], missingItems: missing };
  }
  // Unmatched supplied items may be aliases or paraphrases, not omissions.
  if (missing.length > 0 && remaining.length > 0) {
    return { verdict: "needs-self-grade", shape: "list", matchedItems: matched, missingItems: missing };
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
function markTypedAnswerCore(input: {
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

  if (shape === "numeric" || shape === "list") {
    if (shape === "list" && input.settings?.caseSensitive && response.normalize("NFKC").trim() !== input.expectedAnswer.normalize("NFKC").trim()) {
      return { verdict: "needs-self-grade", shape };
    }
    const results = forms.map((form) => shape === "numeric" ? markNumeric(response, form, input.settings) : markList(response, form, input.settings)).filter((result): result is MarkedAnswer => result !== null);
    return results.find((result) => result.verdict === "correct") ?? results.find((result) => result.verdict === "needs-self-grade") ?? results.find((result) => result.verdict === "partial") ?? results[0] ?? { verdict: "needs-self-grade", shape };
  }

  for (const form of forms) {
    if (input.settings?.caseSensitive && response.normalize("NFKC").trim() === form.normalize("NFKC").trim()) {
      return { verdict: "correct", shape };
    }
    if (input.settings?.caseSensitive) continue;
    if (normalizeAnswerText(form) === normalizedResponse) {
      return { verdict: "correct", shape };
    }
  }

  const looseResponse = looseNormalizeAnswerText(response);
  for (const form of input.settings?.caseSensitive ? [] : forms) {
    if (looseResponse && looseNormalizeAnswerText(form) === looseResponse) {
      return { verdict: "close", shape };
    }
  }

  // Typo tolerance is for words. A list marks its items individually, and prose
  // is never called wrong in the first place.
  if (shape === "short" && !input.settings?.caseSensitive) {
    for (const form of forms) {
      const target = looseNormalizeAnswerText(form);
      const limit = allowedTypoEdits(target.length);
      if (limit > 0 && editDistance(looseResponse, target, limit) <= limit) {
        return { verdict: "close", shape };
      }
    }
  }

  // An unmatched short phrase may be a concise paraphrase. Only structural
  // checkers above may reject confidently; unresolved meaning goes semantic.
  return { verdict: "needs-self-grade", shape };
}

export function markTypedAnswer(input: {
  response: string;
  expectedAnswer: string;
  settings?: CardStudySettings;
}): MarkedAnswer {
  const result = markTypedAnswerCore(input);
  return {
    ...result,
    evaluationSource: result.verdict === "needs-self-grade" ? "fallback" : "deterministic",
  };
}
