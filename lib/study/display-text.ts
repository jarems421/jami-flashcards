export type StudyTextSegment =
  | { type: "text"; value: string }
  | { type: "sup"; value: string };

const SUPERSCRIPT_TO_PLAIN: Record<string, string> = {
  "\u2070": "0",
  "\u00b9": "1",
  "\u00b2": "2",
  "\u00b3": "3",
  "\u2074": "4",
  "\u2075": "5",
  "\u2076": "6",
  "\u2077": "7",
  "\u2078": "8",
  "\u2079": "9",
  "\u207a": "+",
  "\u207b": "-",
  "\u207d": "(",
  "\u207e": ")",
};

const EXPONENT_PATTERN =
  /([A-Za-z0-9\u0370-\u03FF)\]])(?:\*\*|\^)(\{[^{}\n]+\}|[+\-]?\([^)\n]+\)|[+\-]?[A-Za-z0-9\u0370-\u03FF.]+)/gu;
const STORAGE_EXPONENT_PATTERN =
  /([A-Za-z0-9\u0370-\u03FF)\]])\s*(?:\*\*|\^)\s*(\{[^{}\n]+\}|[+\-\u2212\u2013\u2014]?\([^)\n]+\)|[+\-\u2212\u2013\u2014]?[A-Za-z0-9\u0370-\u03FF.]+)/gu;
const SUPERSCRIPT_SEQUENCE_PATTERN =
  /([A-Za-z0-9\u0370-\u03FF)\]])([\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207a\u207b\u207d\u207e]+)/gu;

function normalizeExponent(value: string) {
  let next = value.trim();
  next = next.replace(/[\u2212\u2013\u2014]/g, "-");

  if (next.startsWith("{") && next.endsWith("}")) {
    next = next.slice(1, -1).trim();
  }

  if (
    next.startsWith("(") &&
    next.endsWith(")") &&
    /^[-+]?[A-Za-z0-9\u0370-\u03FF.]+$/u.test(next.slice(1, -1).trim())
  ) {
    next = next.slice(1, -1).trim();
  }

  return next;
}

function normalizeSuperscriptSequence(value: string) {
  return value
    .split("")
    .map((char) => SUPERSCRIPT_TO_PLAIN[char] ?? char)
    .join("");
}

export function normalizeStudyTextInput(text: string) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\u00a0/g, " ")
    .replace(
      SUPERSCRIPT_SEQUENCE_PATTERN,
      (_match, base: string, exponent: string) =>
        `${base}^${normalizeSuperscriptSequence(exponent)}`
    )
    .replace(
      STORAGE_EXPONENT_PATTERN,
      (_match, base: string, exponent: string) =>
        `${base}^${normalizeExponent(exponent)}`
    );
}

export function splitStudyTextForDisplay(text: string): StudyTextSegment[] {
  if (!text) {
    return [{ type: "text", value: "" }];
  }

  const segments: StudyTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(EXPONENT_PATTERN)) {
    const matchText = match[0];
    const base = match[1];
    const exponent = match[2];
    const index = match.index ?? -1;

    if (index < 0) {
      continue;
    }

    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }

    segments.push({ type: "text", value: base });
    segments.push({ type: "sup", value: normalizeExponent(exponent) });
    cursor = index + matchText.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
