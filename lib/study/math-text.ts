export type MathRichTextSegment =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

const MATH_DELIMITER_PATTERN =
  /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g;

export function normalizeLegacyJamiMathText(text: string) {
  return text
    .replace(
      /\b(?:Bigl|Bigr|bigl|bigr|Bigm|bigm)\s*(?:\|\s*)?\{([^{}\n]+)\}\^\{([^{}\n]+)\}/g,
      "evaluated from $1 to $2"
    )
    .replace(/\b(?:Bigl|Bigr|bigl|bigr|Bigm|bigm)\b\s*/g, "");
}

export function splitMathRichText(text: string): MathRichTextSegment[] {
  if (!text) return [{ type: "text", value: "" }];

  const segments: MathRichTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MATH_DELIMITER_PATTERN)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    if (index > 0 && text[index - 1] === "\\") continue;

    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!value) continue;

    if (index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, index) });
    }
    segments.push({
      type: "math",
      value,
      display: match[1] !== undefined || match[3] !== undefined,
    });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
