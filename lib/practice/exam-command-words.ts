/**
 * The command word a question's instruction opens with: "Calculate",
 * "Explain", "Show that".
 *
 * Extraction and tagging read it off the question as printed, and it is kept
 * only when it is really there: the words have to appear in the question's own
 * wording. A command word a model inferred is a guess about the question, not a
 * fact of it. It exists to notice patterns in how a student answers a kind of
 * instruction -- it is never shown to a student as the board's, never used in
 * marking, and a missing one never holds a question back from publication.
 */

export const COMMAND_WORD_MAX_LENGTH = 40;
const COMMAND_WORD_MAX_WORDS = 4;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The command word in one canonical form, or undefined when the question does
 * not print it. "work out", "Work Out" and "WORK OUT" are the same command.
 */
export function normalizeCommandWord(value: unknown, prompt: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const words = value
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > COMMAND_WORD_MAX_WORDS) return undefined;
  const phrase = words.join(" ");
  if (phrase.length > COMMAND_WORD_MAX_LENGTH) return undefined;
  const printed = new RegExp(`(?:^|[^\\p{L}])${words.map(escapeRegExp).join("\\s+")}(?:[^\\p{L}]|$)`, "iu");
  if (!printed.test(prompt)) return undefined;
  const lower = phrase.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
