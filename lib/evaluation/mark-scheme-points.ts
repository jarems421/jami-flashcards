import type { PracticePaperMarkPoint, PracticePaperMarkCode } from "@/lib/practice/mark-schemes";

/**
 * The separate marks a published scheme awards, read out of its own notation.
 *
 * Without this the corpus adapter gave the marker one point worth the whole
 * tariff with every criterion mashed into its text, which is a poor
 * representation of a scheme that states two independent marks.
 *
 * What it is not is a proof about the probe's two scoring errors. Both were
 * partial-credit answers marked against that flattened shape, and the first
 * reading of them was that awarding one of two had been structurally
 * impossible. That is false, and `tests/partial-credit-survives.test.ts`
 * demonstrates it: the marking contract carries a per-criterion `awardedMarks`
 * so a criterion worth several can be part-credited, and 1 of 2 survives the
 * production parser, the tariff join and the student-facing report unchanged.
 *
 * So a flattened scheme is a plausible contributor -- it offers no second
 * criterion to satisfy or miss -- and the actual cause of those two marks
 * stays open until a run captures the markers' own criterion reports.
 *
 * Boards write a mark as a code and a count at the start of a line: `M1` for a
 * method mark, `A1` for accuracy following it, `B1` for an independent mark,
 * `C1` for communication, `P1` for a process mark. That is a structure, so it
 * is read rather than flattened -- but only where reading it is safe. A scheme
 * offering alternative routes, a pool, or a cap is left unstructured and says
 * so, because summing alternatives would invent marks the question does not
 * have.
 */
const POINT_LINE = /^\s*([MABCP])(\d)\b[\s:.–-]*(.*)$/i;

const CODE_MAP: Record<string, PracticePaperMarkCode> = {
  M: "M",
  A: "A",
  B: "B",
  // The scheme vocabulary the shipped types carry is M, A, B and P. A
  // communication mark behaves like an independent one, so it is recorded as B
  // rather than invented as a new code the validator would not know.
  C: "B",
  P: "P",
};

export function parsePointsFromScheme(
  text: string,
  maxMarks: number
): PracticePaperMarkPoint[] {
  if (!text.trim() || maxMarks <= 0) return [];
  if (!schemeStructureIsReadable(text)) return [];

  const points: PracticePaperMarkPoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(POINT_LINE);
    if (!match) {
      // A continuation of the previous mark's wording, not a new mark.
      const body = line.trim();
      if (body && points.length) {
        const last = points[points.length - 1]!;
        last.text = `${last.text} ${body}`.slice(0, 800);
      }
      continue;
    }
    const [, rawCode, rawMarks, body] = match;
    const marks = Number(rawMarks);
    if (!Number.isFinite(marks) || marks < 1) continue;
    points.push({
      id: `p${points.length + 1}`,
      marks,
      code: CODE_MAP[rawCode!.toUpperCase()] ?? "B",
      text: (body ?? "").trim().slice(0, 800) || `${rawCode}${rawMarks}`,
      dep: [],
      // Follow-through is stated in the scheme's own words rather than guessed
      // from the code: "ft" and "follow through" are how boards write it.
      ft: /\bft\b|follow[- ]through/i.test(line),
      essentialTerms: [],
      allow: [],
      reject: [],
    });
  }

  /*
   * Reconstructing the tariff is necessary and not sufficient. Two alternative
   * one-mark routes on a one-mark question also sum correctly, and reading
   * them as cumulative would let a marker award both.
   */
  const total = points.reduce((sum, point) => sum + point.marks, 0);
  if (points.length < 2 || total !== maxMarks) return [];
  return points;
}

/**
 * Schemes whose structure cannot be read from their notation alone.
 *
 * A pool is a choice among marks and a cap changes what the codes add up to,
 * so both are left whole. So is a scheme stating a dependency: `M1dep`, or
 * "dependent on the previous M1", makes one mark conditional on another, and
 * the parsed points carry `dep: []`. Leaving that empty avoids inventing a
 * rule and instead asserts there is none, which is a different falsehood --
 * so a scheme that states one is not claimed as structured at all. One of the
 * corpus's own maths schemes does exactly this.
 *
 * `oe` and `cao` are deliberately not treated as dependencies. They are
 * acceptance rules -- "or equivalent", "correct answer only" -- and they
 * travel with the mark's own wording into the criterion text, so the marker
 * still sees them. An earlier draft lumped them in with `dep` and would have
 * discarded a perfectly readable three-mark scheme over an "or equivalent".
 *
 * Alternative routes are detected too, and honestly this is precaution rather
 * than a fix for anything observed: no scheme in the corpus contains one. The
 * reasoning first given for it -- that two alternative one-mark routes sum to
 * a one-mark tariff -- was simply wrong arithmetic, they sum to two and the
 * tariff check already rejects them. It stays because a mixed scheme could in
 * principle coincide with its tariff, and it costs nothing; it is not evidence
 * that every alternative form is recognised.
 */
const ALTERNATIVE_ROUTE = /^\s*(or\b|alternatively\b|alternative (method|approach)\b)/im;
const POOL_OR_CAP =
  /\b(any (one|two|three|four|five|\d+) from|max(imum)? of \d+|maximum \d+ marks?|up to \d+ marks?)\b/i;
// `M1dep` runs the code and the rule together, so there is no word boundary
// before `dep` to anchor on -- the digit form is matched separately.
const DEPENDENCY = /(\bdep\b|\d\s*dep\b|dependent (on|upon)\b|depends on\b)/i;

export function schemeStructureIsReadable(text: string) {
  if (!text.trim()) return false;
  return !ALTERNATIVE_ROUTE.test(text) && !POOL_OR_CAP.test(text) && !DEPENDENCY.test(text);
}
