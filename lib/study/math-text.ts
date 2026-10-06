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

/*
 * One piece of LaTeX written without delimiters: a whole environment, a
 * \left...\right pair, or a single command with its arguments and any script
 * straight after it. Environments and pairs are matched whole, because wrapping
 * their halves separately gives KaTeX a \left with no \right.
 */
const BARE_LATEX_PATTERN =
  /\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}|\\left[\s\S]*?\\right\s*(?:\\[a-zA-Z]+|\\?[^\sa-zA-Z])|\\[a-zA-Z]+(?:\s*\{(?:[^{}]|\{[^{}]*\})*\})*(?:\s*[\^_](?:\{[^{}]*\}|[A-Za-z0-9]))?/g;

/**
 * LaTeX that arrived without delimiters, wrapped so it renders.
 *
 * Marking reports and mark schemes quote maths as it was written, and a scheme
 * extracted from a PDF or a marker copying it often drops the `$`. The result
 * reached students as `\begin{pmatrix} 4 \\ -3 \end{pmatrix}` rather than as a
 * column vector. Only text outside existing delimiters is touched, so maths
 * that was written properly is left exactly as it was.
 */
export function wrapBareLatex(text: string): string {
  if (!text || !/\\[a-zA-Z]/.test(text)) return text;
  return splitMathRichText(text)
    .map((segment) => {
      if (segment.type === "math") {
        return segment.display ? `$$${segment.value}$$` : `$${segment.value}$`;
      }
      return segment.value.replace(BARE_LATEX_PATTERN, (match, _environment, offset: number, whole: string) =>
        offset > 0 && whole[offset - 1] === "\\" ? match : `$${match.trim()}$`
      );
    })
    .join("");
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

    const display = match[1] ?? match[3];
    if (display !== undefined) {
      const end = index + match[0].length;
      const after = restOfLine(text, end);
      // Punctuation that closes the sentence goes inside the display, as
      // typeset maths has it; left after the closing $$ it stops the block
      // being read as maths at all.
      const closing = /^[.,;:]$/.test(after.trim()) ? after.trim() : "";
      // \[ ... \] and $$...$$ -> multi-line display math, except where a line
      // break would split something that has to stay on one line -- a table
      // row, "Hence $$y = 3$$ as required", a list item's words -- and so
      // the maths stays inline, at display size.
      if (
        isOnTableRow(text, index) ||
        (after.trim() && !closing) ||
        (isOnListItem(text, index) && hasTextBefore(text, index))
      ) {
        result.push(`$\\displaystyle ${display.trim().replace(/\s*\n\s*/g, " ")}$`);
      } else {
        result.push(`$$\n${display.trim()}${closing}\n$$`);
        cursor = end + after.length;
        continue;
      }
    } else if (match[2] !== undefined) {
      // \( ... \) -> inline math
      result.push(`$${match[2].trim()}$`);
    } else if (match[4] !== undefined) {
      // $...$ -> keep as inline math
      result.push(`$${match[4]}$`);
    }

    cursor = index + match[0].length;
  }

  result.push(text.slice(cursor));
  return result.join("");
}

/**
 * Whether words come before `index` on its line. A list marker or quote
 * marker does not count: "- $$a = b$$" is a display on a list item.
 */
function hasTextBefore(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return !/^\s*(?:>\s*)*(?:(?:[-*+]|\d{1,3}[.)])\s+)?$/.test(text.slice(lineStart, index));
}

/** Whether the character at `index` sits on a Markdown list item. */
function isOnListItem(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^\s*(?:>\s*)*(?:[-*+]|\d{1,3}[.)])\s/.test(text.slice(lineStart, index));
}

/** The rest of the line from `index`, up to but not including its newline. */
function restOfLine(text: string, index: number) {
  const lineEnd = text.indexOf("\n", index);
  return text.slice(index, lineEnd < 0 ? text.length : lineEnd);
}

/** Whether the character at `index` sits on a Markdown table row. */
function isOnTableRow(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^\s*\|/.test(text.slice(lineStart, index));
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

/*
 * Commands only maths uses. Inline code holding one of these is maths the
 * model put in backticks by mistake. Code with a stray backslash -- a "\n" in
 * a Python string -- is not, because every name here must end at a non-letter.
 */
const MATH_COMMAND_PATTERN =
  /\\(?:frac|dfrac|tfrac|sqrt|times|cdot|div|pm|mp|leq?|geq?|neq|approx|equiv|propto|infty|int|iint|oint|sum|prod|lim|log|ln|exp|sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan|sinh|cosh|tanh|alpha|beta|gamma|Gamma|delta|Delta|epsilon|varepsilon|eta|theta|Theta|kappa|lambda|Lambda|mu|xi|pi|Pi|rho|sigma|Sigma|tau|phi|Phi|varphi|chi|psi|Psi|omega|Omega|partial|nabla|vec|hat|bar|overline|underline|overrightarrow|text|mathrm|mathbf|mathit|mathbb|operatorname|left|right|begin|circ|degree|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|rightleftharpoons|mapsto|notin|subset|subseteq|cup|cap|emptyset|forall|exists|binom|therefore|because|angle|triangle|perp|parallel|ce|pu|quad|qquad|displaystyle|boxed|ldots|cdots)(?![a-zA-Z])/;

/** A piece of text that is nothing but delimited maths. */
const DELIMITED_MATH_PATTERN =
  /^(?:\$\$([\s\S]+)\$\$|\$([^$]+)\$|\\\(([\s\S]+)\\\)|\\\[([\s\S]+)\\\])$/;

/** Letters, numbers and arithmetic with a power in it: `x^2 + 3x`. */
const PLAIN_POWER_PATTERN = /^[A-Za-z0-9\s+\-*/=().,{}]*[A-Za-z0-9)}]\s*\^[A-Za-z0-9\s+\-*/=().,^{}]+$/;

function readDelimitedMath(value: string): string | null {
  const match = value.match(DELIMITED_MATH_PATTERN);
  if (!match) return null;
  const math = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
  return math && !math.includes("$") ? math : null;
}

/**
 * Maths a model wrapped in backticks, or null if it is really code.
 *
 * Models put an equation in inline code often enough -- `$v = u + at$`,
 * `\frac{1}{2}mv^2` -- and it reached students as monospace with its dollar
 * signs showing, in the code colour, which on the light theme is a red. Code
 * is only read as maths when it could not sensibly be anything else.
 */
export function readInlineCodeAsMath(code: string): string | null {
  const value = code.trim();
  if (!value) return null;
  if (value.startsWith("$") || value.startsWith("\\(") || value.startsWith("\\[")) {
    return readDelimitedMath(value);
  }
  if (value.includes("$")) return null;
  if (MATH_COMMAND_PATTERN.test(value)) return value;
  if (PLAIN_POWER_PATTERN.test(value)) return value;
  return null;
}

const MATH_FENCE_LANGUAGES = new Set(["latex", "tex", "math", "katex"]);

/**
 * A fenced block that is maths, as the maths inside it, or null if it is code.
 *
 * A `latex` or `math` fence is maths by its own label. An unlabelled one is
 * maths only when everything in it is already in maths delimiters.
 */
export function readFencedBlockAsMath(block: string): string | null {
  const fence = block.match(/^(`{3,}|~{3,})[ \t]*([^\s`~]*)[^\n]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*$/);
  if (!fence) return null;
  const language = fence[2].toLowerCase();
  const body = fence[3].trim();
  if (!body) return null;
  const delimited = readDelimitedMath(body);
  if (MATH_FENCE_LANGUAGES.has(language)) return delimited ?? (body.includes("$") ? null : body);
  return language ? null : delimited;
}

/**
 * An AI reply, made ready for the Markdown renderer.
 *
 * Everything preprocessMathDelimiters does, plus what a reply needs before its
 * maths can render: LaTeX commands written with no delimiters, and maths put
 * in code by mistake. `repairLatex` is applied to everything that is not code,
 * for repairs that belong to the model rather than to Markdown. Real code is
 * left exactly as it was written.
 */
export function prepareAiMarkdown(
  text: string,
  repairLatex: (value: string) => string = (value) => value
): string {
  const parts: string[] = [];
  let cursor = 0;

  const pushProse = (value: string) => {
    if (value) parts.push(normalizeMathDelimiters(wrapBareLatex(repairLatex(value))));
  };

  for (const match of text.matchAll(CODE_BLOCK_PATTERN)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    pushProse(text.slice(cursor, index));
    const code = match[0];
    if (/^(?:`{3,}|~{3,})/.test(code)) {
      const math = readFencedBlockAsMath(code);
      parts.push(math ? `$$\n${repairLatex(math)}\n$$` : code);
    } else {
      const math = readInlineCodeAsMath(code.slice(1, -1));
      parts.push(math ? `$${repairLatex(math)}$` : code);
    }
    cursor = index + code.length;
  }
  pushProse(text.slice(cursor));

  return parts.join("");
}
