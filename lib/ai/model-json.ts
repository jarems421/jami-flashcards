/**
 * Repairs LaTeX backslashes that the model failed to escape for JSON.
 *
 * The assistant asks the provider for a JSON object whose `answer` field holds
 * Markdown with LaTeX in it. A backslash inside a JSON string has to be written
 * `\\`, and the model usually does, but not always. When it writes a single
 * backslash the result is never a syntax error the caller can notice:
 *
 * - `\text{o}` -> `\t` is a valid JSON escape, so it parses to a TAB followed
 *   by `ext{o}`, and the student sees `extoextC` where `20°C` belonged.
 * - `\sqrt{x}` -> `\s` is not a valid escape, so JSON.parse throws and the
 *   whole answer is discarded.
 *
 * Doubling those stray backslashes before parsing fixes both. The scan skips
 * over `\\` as a unit, so running it on already-correct output changes nothing.
 *
 * `\n` is deliberately left alone: real paragraph breaks are written `\n` and
 * are followed by a word, so there is no way to tell them from `\nu` without
 * guessing. Only n-commands that cannot be read as a line starting with an
 * English word are recovered.
 */

const JSON_ESCAPE_CHARS = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/** Escapes that must be preserved: unambiguous, or a unicode sequence. */
const PRESERVED_ESCAPE_CHARS = new Set(['"', "\\", "/", "u"]);

/**
 * n-commands worth recovering. Each continues with letters that do not begin an
 * English word, so a genuine newline can never be mistaken for one. `\nu` and
 * `\ne` are excluded on purpose: a paragraph starting "under" or "next" is
 * ordinary prose.
 */
const RECOVERABLE_NEWLINE_COMMANDS =
  /^n(?:abla|eq|otin|leq|geq|subseteq|subset|parallel|rightarrow|equiv)/;

export function repairModelJsonBackslashes(raw: string): string {
  if (!raw.includes("\\")) return raw;

  let out = "";

  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at];

    if (char !== "\\") {
      out += char;
      continue;
    }

    const next = raw[at + 1];

    // A trailing backslash is a half-arrived escape mid-stream. Leave it for
    // the next chunk rather than guessing.
    if (next === undefined) {
      out += char;
      continue;
    }

    if (PRESERVED_ESCAPE_CHARS.has(next)) {
      out += char + next;
      at += 1;
      continue;
    }

    // Not a JSON escape at all, so the model meant a literal backslash and the
    // document currently does not parse: `\sqrt`, `\cdot`, `\pi`, `\alpha`.
    if (!JSON_ESCAPE_CHARS.has(next)) {
      out += "\\\\";
      continue;
    }

    if (next === "n") {
      if (RECOVERABLE_NEWLINE_COMMANDS.test(raw.slice(at + 1))) {
        out += "\\\\";
        continue;
      }
      out += char + next;
      at += 1;
      continue;
    }

    // b, f, r, t. A control character sitting directly against a word is not
    // something a prose answer ever needs, whereas `\text`, `\times`, `\frac`,
    // `\beta` and `\rightarrow` are everyday maths.
    if (/[a-zA-Z]/.test(raw[at + 2] ?? "")) {
      out += "\\\\";
      continue;
    }

    out += char + next;
    at += 1;
  }

  return out;
}
