/**
 * Whether the marker's two stated values actually disagree.
 *
 * Criterion results now carry what the guide requires beside what the candidate
 * produced, which makes a new question countable: how often does Jami write
 * down a mismatch and award the mark anyway? Counting it naively answers a
 * different question badly. A first attempt reported 63% of mismatches awarded,
 * and almost all of them were artefacts:
 *
 *   x/3 = 5^2        vs  5^2 = x/3        the same equation, written the other way
 *   x = 75           vs  75 = x           likewise
 *   midpoint of PQ   vs  (4, 3)           a label against a value, not comparable
 *
 * So two things have to be true before a difference means anything: both sides
 * must be values rather than one being a description of the mark, and the
 * comparison must survive the ways the same value gets written down.
 *
 * This is deliberately conservative. Anything it cannot confidently call is
 * `unknown`, because a metric that guesses is worse than one that abstains --
 * the whole point is to measure a real behaviour, and inflating it with string
 * noise would hide whatever is actually there.
 */

export type ValueComparison = "match" | "differ" | "unknown";

/**
 * A value carries mathematics; a label describes the mark.
 *
 * `(4, 3)` and `y = 7x - 8` are values. `midpoint of PQ` and `calculate the
 * gradient` are labels, and a marker that puts one in each field has annotated
 * rather than compared.
 */
export function looksLikeValue(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Digits or operators are what separates a quantity from a description of
  // one. Words alone are a label however short.
  if (!/[0-9=+\-*/^√∫π]/.test(trimmed)) return false;
  // "calculate the gradient of 2 lines" has a digit and is still a label, so a
  // run of ordinary words disqualifies it.
  const words = trimmed.split(/\s+/).filter((word) => /^[a-z]{3,}$/i.test(word));
  return words.length < 3;
}

const normalise = (text: string) =>
  text
    .toLowerCase()
    // A scheme states what it will accept as well as the value: "-10x^(-4)
    // stated or implied by bullet 3", "or equivalent". None of that is part of
    // the value, and all of it defeats a comparison against a candidate who
    // simply wrote the thing.
    .replace(/(stated or implied|or equivalent).*$/, "")
    .replace(/\s+/g, "")
    .replace(/[.,;]+$/, "")
    .replace(/[−–—]/g, "-")
    .replace(/[·×]/g, "*")
    .replace(/÷/g, "/")
    .replace(/sqrt/g, "√")
    // Bracketing is a writing choice, not a different value.
    .replace(/[()\[\]{}]/g, "");

/**
 * How long an expression may be and still be compared by string.
 *
 * Beyond a certain length the notation a marker happens to choose swamps the
 * mathematics: `(3/5)*(3/sqrt(45)) - (4/5)*(6/sqrt(45))` against the same thing
 * with different brackets and a root sign is one value written twice, and no
 * amount of normalising catches every variant. Short values -- `7` against
 * `10`, `-1` against `7` -- are exactly the cases this metric exists to count,
 * and are unambiguous. Anything longer abstains.
 *
 * Twelve characters is where the false positives stopped. At twenty it was
 * still calling `p = 2/9, 2` different from `p = 2, p = 2/9`, and `-6x^(1/2)`
 * different from `-6x^½`. Precision matters far more than recall here: the
 * question is whether Jami awards marks it has itself recorded as wrong, and a
 * count inflated with notation noise cannot answer it.
 */
const COMPARABLE_LENGTH = 12;

/**
 * `x = 75` and `75 = x` are one statement, so the sides are compared as a set,
 * and so is a list of solutions: a quadratic has two roots and the order they
 * are written in is not part of the answer. `x = -3 and x = 1` is the same
 * answer as `x = 1, x = -3`.
 */
const sideSet = (text: string) =>
  normalise(text)
    // Plain "and", because normalising has already removed the spaces that a
    // word boundary would have needed. Safe here only because looksLikeValue
    // has already rejected anything prose enough to contain the word.
    .split(new RegExp("[,]|and"))
    .flatMap((part) => part.split("="))
    .filter(Boolean);
// Deduplicated, because splitting `p = 2, p = 2/9` on both commas and equals
// leaves `p` twice while `p = 2/9, 2` leaves it once, and the same answer
// would compare unequal to itself.
const asKey = (parts: readonly string[]) => [...new Set(parts)].sort().join("=");

export function compareValues(scheme: string, candidate: string): ValueComparison {
  if (!looksLikeValue(scheme) || !looksLikeValue(candidate)) return "unknown";

  const left = sideSet(scheme);
  const right = sideSet(candidate);
  if (asKey(left) === asKey(right)) return "match";

  // Past this point a difference is being asserted rather than observed, so
  // anything long enough for notation to explain it declines to answer.
  if (asKey(left).length > COMPARABLE_LENGTH || asKey(right).length > COMPARABLE_LENGTH) {
    return "unknown";
  }

  /**
   * A scheme usually states the value alone while the candidate states the
   * whole line it sits in -- `-1` against `y = -1`. Matching a lone value
   * against one side of the other statement covers that, where a substring
   * test would also have accepted `7` inside `17`.
   */
  if (left.length === 1 && right.includes(left[0])) return "match";
  if (right.length === 1 && left.includes(right[0])) return "match";

  /** A scheme listing alternatives accepts any of them. */
  const alternatives = normalise(scheme).split(new RegExp("(?<![a-z])or(?![a-z])")).filter(Boolean);
  if (alternatives.length > 1) {
    for (const option of alternatives) {
      const parts = sideSet(option);
      if (asKey(parts) === asKey(right)) return "match";
      if (parts.length === 1 && right.includes(parts[0])) return "match";
    }
  }

  return "differ";
}
