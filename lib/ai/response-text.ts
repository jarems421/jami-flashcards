/**
 * Text handling for AI replies that are rendered as Markdown by
 * `components/ai/AiResponseRenderer`.
 *
 * This is deliberately separate from `cleanGeneratedStudyText` in
 * `lib/ai/card-autocomplete.ts`. That function exists to flatten model output
 * into plain study text for card faces: it strips Markdown emphasis and
 * headings, and (unless `preserveLatex` is set) removes every `$` and
 * backslash while rewriting LaTeX into Unicode. Running it on a chat reply
 * destroys exactly the Markdown and LaTeX the renderer is there to render.
 *
 * So the rules here are the opposite: preserve everything structural, and only
 * tidy whitespace that the model added by accident.
 */

/**
 * Decode literal `\uXXXX` escape sequences that models sometimes emit instead
 * of the character itself.
 */
export function decodeLiteralUnicodeEscapes(text: string) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

/**
 * Every Unicode space separator, so non-breaking and narrow spaces from the
 * model collapse to an ordinary space. Written as a property escape so the
 * source stays ASCII-only.
 */
const UNICODE_SPACE_PATTERN = /\p{Zs}/gu;

const WRAPPING_FENCE_PATTERN = /^```([A-Za-z]*)\n([\s\S]*)\n```$/;

/**
 * Models occasionally wrap an entire Markdown reply in a code fence, which
 * would otherwise render as a literal code block.
 *
 * Only unwrap when the fence has no language (or a prose language) and the
 * body contains no further fences, so a reply that genuinely opens and closes
 * with code blocks is left alone.
 */
function stripWrappingCodeFence(text: string) {
  const match = text.match(WRAPPING_FENCE_PATTERN);
  if (!match) return text;

  const language = match[1].toLowerCase();
  if (language && language !== "markdown" && language !== "md" && language !== "text") {
    return text;
  }

  const body = match[2];
  if (body.includes("```")) return text;

  return body;
}

/**
 * Tidy an AI reply without altering its Markdown or LaTeX.
 *
 * Intentionally does NOT collapse runs of spaces or strip trailing spaces:
 * leading indentation carries meaning in nested lists and fenced code, and two
 * trailing spaces are a Markdown hard line break.
 */
export function cleanAiResponseText(text: string): string {
  if (!text) return "";

  const unwrapped = stripWrappingCodeFence(
    decodeLiteralUnicodeEscapes(text).replace(/\r\n/g, "\n").trim()
  );

  return unwrapped
    .replace(UNICODE_SPACE_PATTERN, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
