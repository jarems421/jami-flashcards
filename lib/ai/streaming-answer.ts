/**
 * Reads the "answer" field out of a JSON object that is still being written.
 *
 * The assistant asks the provider for structured JSON, so a streamed response
 * arrives as a partial document: `{"answer":"Photosynthesis is` and so on. This
 * pulls out however much of that string has arrived, so the prose can be shown
 * while the rest of the object, including the source references, is still on
 * its way.
 *
 * Deliberately not a JSON parser. It finds the field, scans to the first
 * unescaped quote, and lets JSON.parse handle unescaping the fragment, which is
 * enough for one known string field and cannot go wrong on the rest of the
 * document.
 */

import { repairModelJsonBackslashes } from "@/lib/ai/model-json";

const ANSWER_KEY_PATTERN = /"answer"\s*:\s*"/;

/**
 * How far past a backslash the repair can look before it decides what the
 * backslash meant: the longest n-command name, or a unicode escape.
 */
const BACKSLASH_LOOKAHEAD = 16;

/**
 * The buffer up to the first backslash the repair cannot decide yet.
 *
 * Whether `\t` is a tab or the start of `\times` depends on what follows it.
 * Read at a chunk boundary, it was a tab, and the route had already sent it on
 * by the time "imes" arrived -- the student watched `\times` arrive as a gap
 * and "imes". Holding back the last few characters after a backslash costs
 * nothing visible and means nothing shown is ever taken back.
 */
function settledPrefix(rawBuffer: string) {
  const undecidedFrom = rawBuffer.length - BACKSLASH_LOOKAHEAD;
  for (let at = rawBuffer.indexOf("\\"); at >= 0; at = rawBuffer.indexOf("\\", at)) {
    const next = rawBuffer[at + 1];
    if (next === undefined) return rawBuffer.slice(0, at);
    // `\"`, `\\` and `\/` mean one thing whatever follows.
    if (next === '"' || next === "\\" || next === "/") {
      at += 2;
      continue;
    }
    if ("bfnrtu".includes(next) && at > undecidedFrom) return rawBuffer.slice(0, at);
    at += 1;
  }
  return rawBuffer;
}

export function extractStreamingAnswer(rawBuffer: string): string {
  // Unescaped LaTeX backslashes would otherwise be unescaped into control
  // characters here, mid-stream, before anything else can notice.
  const buffer = repairModelJsonBackslashes(settledPrefix(rawBuffer));
  const opening = buffer.match(ANSWER_KEY_PATTERN);
  if (!opening || opening.index === undefined) return "";

  const start = opening.index + opening[0].length;
  let end = start;

  // Walk to the closing quote, skipping any that are escaped. A backslash
  // always consumes the character after it, so escaped quotes and escaped
  // backslashes are both handled by the same step.
  while (end < buffer.length) {
    const char = buffer[end];
    if (char === "\\") {
      end += 2;
      continue;
    }
    if (char === '"') break;
    end += 1;
  }

  const fragment = buffer.slice(start, Math.min(end, buffer.length));
  if (!fragment) return "";

  try {
    return JSON.parse(`"${fragment}"`) as string;
  } catch {
    // A trailing partial escape such as "\u00e" is not yet valid on its own.
    // Drop back to the last safe boundary rather than showing nothing.
    for (let cut = fragment.length - 1; cut > 0; cut -= 1) {
      if (fragment[cut - 1] === "\\") continue;
      try {
        return JSON.parse(`"${fragment.slice(0, cut)}"`) as string;
      } catch {
        // This cut still lands inside an escape sequence. Keep walking back;
        // the loop ends at "" if no boundary is valid yet.
        continue;
      }
    }
    return "";
  }
}
