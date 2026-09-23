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

/**
 * Pulls the JSON array out of a model response that may have wrapped it in
 * prose or a code fence. Returns the input unchanged when no array is found,
 * so the caller's JSON.parse reports the original text.
 */
export function extractJsonArray(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }

  const match = trimmed.match(/\[[\s\S]*\]/);
  return match ? match[0] : trimmed;
}

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

/**
 * Pulls the JSON object out of a model response that wrapped it.
 *
 * A model asked for JSON returns JSON most of the time and, the rest of the
 * time, returns JSON inside a code fence or with a sentence in front of it. A
 * bare JSON.parse treats every one of those as a total failure, and a caller
 * that then falls back to a canned line shows the student a reply nobody wrote.
 *
 * Returns the input unchanged when there is no object to find, so the caller's
 * own parse still reports the original text.
 */
export function unwrapModelJsonObject(text: string) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/**
 * Rewrites the closing brackets at the end of a model reply to match what is open.
 *
 * Asked for a long nested object, a model gets the last few closers wrong more
 * often than anything else in it: one short -- `]}` where `]}}` belonged -- or
 * the right number of the wrong kind -- `}}}` where `]}}` belonged. A reply
 * that is otherwise complete then fails to parse over a character or two.
 * After the last value, a run of closers can mean only one thing: close
 * whatever is open. So that run is replaced with exactly that.
 *
 * Nothing before the run is touched. A reply that ends inside a string was cut
 * off, not miscounted, and one whose closers do not match before the run has
 * gone wrong in the middle; both are returned unchanged. A brace dropped in the
 * middle and made up for at the end parses into the wrong shape, which the
 * caller's own validation refuses -- the same outcome as not repairing it.
 */
export function closeUnbalancedJson(raw: string): string {
  const trailing = /[\s\]}]*$/.exec(raw)?.[0] ?? "";
  const body = raw.slice(0, raw.length - trailing.length);
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") open.push("}");
    else if (char === "[") open.push("]");
    else if ((char === "}" || char === "]") && open.pop() !== char) return raw;
  }
  if (inString || open.length === 0) return raw;
  const closed = body + open.reverse().join("");
  return closed === raw.trimEnd() ? raw : closed;
}
