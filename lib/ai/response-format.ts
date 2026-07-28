/**
 * Base formatting rules for replies rendered by
 * `components/ai/AiResponseRenderer`.
 *
 * The renderer understands GitHub-flavoured Markdown plus LaTeX maths via
 * KaTeX, so the model is asked to produce exactly that. Without this the model
 * defaults to bare Unicode maths, which renders as literal characters and
 * reads badly at small sizes.
 *
 * Not exported: the assistant is the only surface that returns a rendered
 * reply, and it goes through getJsonAnswerFormatPrompt because its answer
 * arrives inside a JSON envelope. Export this again if a route ever returns
 * prose directly.
 *
 * Escaping note: backslashes are doubled because this is a template string. An
 * unrecognised escape such as `\s` silently collapses to `s`, which would
 * corrupt every LaTeX example below.
 */
const AI_RESPONSE_FORMAT_PROMPT = `Formatting rules for your reply:
- Use GitHub-flavoured Markdown for structure: **bold** for key terms, "-" for bullet lists, "1." for ordered steps, tables for comparisons, and fenced code blocks for code.
- For mathematics, use precise conventional terminology and notation.
- Put every mathematical expression in valid TeX delimiters: $...$ inline and $$...$$ on its own line for display maths.
- Use proper structures such as \\frac{a}{b}, \\int_{0}^{2}, \\sum_{i=1}^{n}, exponents, subscripts, radicals, limits, and units.
- Never leave a TeX command outside delimiters, mix raw TeX with plain Unicode notation, or expose sizing commands such as \\Bigl in prose.
- Never write bare Unicode maths characters such as ², ₃, √, ·, ±, π, θ, or Δ. Write $x^2$, $x_3$, $\\sqrt{x}$, $\\cdot$, $\\pm$, $\\pi$, $\\theta$, and $\\Delta$ instead.
- Do not escape the dollar signs, and do not wrap the whole reply in a code fence.
- Never emit raw HTML.`;

/**
 * Formatting contract for generated card and question text.
 *
 * Card faces are rendered by StudyText, which sends delimited maths to KaTeX
 * but does not render Markdown, so the rules differ from a chat reply: LaTeX
 * yes, Markdown no.
 */
export const CARD_TEXT_FORMAT_PROMPT = `Card text formatting:
- Card fronts, backs, questions, and answers are plain text, not Markdown. Do not use **bold**, headings, bullet syntax, or code fences.
- Write every mathematical expression as LaTeX inside $...$, for example $\\frac{a}{b}$, $x_1$, and $\\sqrt{x}$.
- Never write bare Unicode maths characters such as ², √, ·, or π.`;

/**
 * Variant for routes that return the answer inside a JSON envelope via
 * `responseSchema`, where the formatting applies to one string field rather
 * than to the whole response.
 */
export function getJsonAnswerFormatPrompt(fieldName: string) {
  return `${AI_RESPONSE_FORMAT_PROMPT}
- These formatting rules apply to the text inside the "${fieldName}" field, not to the JSON structure around it.`;
}
