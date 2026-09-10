import type { PracticePaperMarkPoint, PracticePaperMarkCode } from "@/lib/practice/mark-schemes";

/**
 * The separate marks a published scheme awards, read out of its own notation.
 *
 * Without this the corpus adapter gave the marker one point worth the whole
 * tariff, with every criterion mashed into its text. That is not a
 * simplification, it is a different question: a two-mark answer with one
 * criterion met can only be scored 0 or 2, so every partially correct response
 * is wrong by a mark whichever way the marker goes.
 *
 * It is what the first paid probe actually measured. Both of its two scoring
 * errors were partial-credit answers -- reference 1 of 2, agreed by both
 * examiners -- and the marker returned 0 on one and 2 on the other. Neither
 * was a misreading. Awarding 1 was not available to it.
 *
 * Boards write these marks as a code and a count at the start of a line: `M1`
 * for a method mark, `A1` for accuracy following it, `B1` for an independent
 * mark, `C1` for communication, `P1` for a process mark. That is a structure,
 * so it is read rather than flattened.
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
   * Only used when it reconstructs the tariff exactly. A scheme that parses to
   * more or fewer marks than the question is worth has been misread, and a
   * misread structure is worse than an honest single point -- it would let a
   * marker award marks the question does not have.
   */
  const total = points.reduce((sum, point) => sum + point.marks, 0);
  if (points.length < 2 || total !== maxMarks) return [];
  return points;
}
