export type MathRichTextSegment =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

export type MathRichDisplaySegment = MathRichTextSegment & {
  trailingPunctuation?: string;
};

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

/**
 * Whether the text contains at least one balanced maths expression.
 *
 * Deliberately implemented on top of splitMathRichText so detection can never
 * disagree with rendering: an unbalanced `$` or a bare price like "$5" is not
 * treated as maths, exactly as the splitter treats it.
 */
export function hasMathDelimiters(text: string): boolean {
  if (!text || !/[$\\]/.test(text)) return false;
  return splitMathRichText(text).some((segment) => segment.type === "math");
}

export function attachInlineMathPunctuation(
  input: readonly MathRichTextSegment[]
): MathRichDisplaySegment[] {
  const segments: MathRichDisplaySegment[] = input.map((segment) => ({
    ...segment,
  }));
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = segments[index + 1];
    if (segment.type !== "math" || segment.display || next.type !== "text") {
      continue;
    }
    const punctuation = next.value.match(/^[,.;:!?]/)?.[0];
    if (!punctuation) continue;
    segment.trailingPunctuation = punctuation;
    next.value = next.value.slice(punctuation.length);
  }
  return segments;
}

/**
 * Normalize math delimiters so that remark-math / rehype-katex can render them.
 *
 * - \( ... \) -> $...$  (inline)
 * - \[ ... \] -> multi-line $$...$$ (display)
 * - $$...$$   -> multi-line $$...$$ (display)
 *
 * Multi-line display math is required by remark-math v6 so that rehype-katex
 * wraps the output with the katex-display class.
 *
 * Note: this function does not protect Markdown code blocks or inline code.
 * Use preprocessMathDelimiters when working with raw Markdown.
 */
export function normalizeMathDelimiters(text: string): string {
  const result: string[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MATH_DELIMITER_PATTERN)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    // Skip escaped delimiters such as \$...\$
    if (index > 0 && text[index - 1] === "\\") continue;

    result.push(text.slice(cursor, index));

    if (match[1] !== undefined) {
      // \[ ... \] -> multi-line display math
      result.push(`$$\n${match[1].trim()}\n$$`);
    } else if (match[2] !== undefined) {
      // \( ... \) -> inline math
      result.push(`$${match[2].trim()}$`);
    } else if (match[3] !== undefined) {
      // $$...$$ -> multi-line display math
      result.push(`$$\n${match[3].trim()}\n$$`);
    } else if (match[4] !== undefined) {
      // $...$ -> keep as inline math
      result.push(`$${match[4]}$`);
    }

    cursor = index + match[0].length;
  }

  result.push(text.slice(cursor));
  return result.join("");
}

// Pattern that captures fenced code blocks, tilde code blocks, and inline code
// so that math normalisation can skip them.
const CODE_BLOCK_PATTERN = /(`{3,}[\s\S]*?`{3,}|~{3,}[\s\S]*?~{3,}|`[^`\n]*?`)/g;

/**
 * Like normalizeMathDelimiters, but leaves Markdown code blocks and inline
 * code untouched. This is the function the renderer should use on raw AI
 * output before handing it to react-markdown.
 */
export function preprocessMathDelimiters(text: string): string {
  const parts: { type: "text" | "code"; value: string }[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CODE_BLOCK_PATTERN)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    if (index > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, index) });
    }
    parts.push({ type: "code", value: match[0] });
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts
    .map((part) => (part.type === "code" ? part.value : normalizeMathDelimiters(part.value)))
    .join("");
}
