import type { PdfPageText } from "@/lib/practice/exam-page-regions";

/**
 * Whether a calculator is allowed, read off the paper's own front page.
 *
 * A GCSE maths student thinks in exactly these terms -- "I need non-calculator
 * practice" -- and the corpus could not answer them: `calculatorAllowed` was
 * declared on a question and never once written.
 *
 * It is read rather than configured. A table of which paper allows what would
 * have to be maintained per board, per specification and per year, and would
 * be wrong quietly; the paper states it plainly on its cover, in words the
 * board chose, and AQA states it twice. So the answer comes from the same
 * place a student would look.
 *
 * `undefined` when the cover says nothing either way, because "we do not know"
 * and "no calculator" are different answers and only one of them should ever
 * filter a question out.
 */
const FORBIDDEN = [
  /\bmust\s+not\s+use\s+a\s+calculator\b/i,
  /\bnon[-\s]?calculator\b/i,
  /\bwithout\s+a\s+calculator\b/i,
  /\bcalculators?\s+(?:are|is)\s+not\s+(?:allowed|permitted)\b/i,
];

const ALLOWED = [
  /\byou\s+may\s+use\s+a\s+calculator\b/i,
  /\bcalculators?\s+(?:are|is)\s+(?:allowed|permitted)\b/i,
  // "For this paper you must have: a calculator, mathematical instruments..."
  /\byou\s+must\s+have\b[\s\S]{0,200}?\ba\s+calculator\b/i,
  /\bpaper\s+\d\s*[-–—:]?\s*calculator\b/i,
];

/** How much of the paper counts as its cover. */
const COVER_PAGES = 1;

export function readCalculatorPolicy(pages: PdfPageText[]): boolean | undefined {
  const cover = pages
    .filter((page) => page.page <= COVER_PAGES)
    .map((page) => page.items.map((item) => item.text).join(" "))
    .join(" ")
    .replace(/\s+/g, " ");
  if (!cover.trim()) return undefined;
  /*
   * Refusals win, and are asked first. "Paper 1 Non-Calculator" contains the
   * word the permissive patterns look for, so testing the other way round
   * turns every non-calculator paper into a calculator one.
   */
  if (FORBIDDEN.some((pattern) => pattern.test(cover))) return false;
  if (ALLOWED.some((pattern) => pattern.test(cover))) return true;
  return undefined;
}
