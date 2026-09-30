/**
 * Ranking the passages a search found in a student's material.
 *
 * The search itself compares meaning: every passage of every file (about a
 * page, with its section heading and pages) has an embedding, and the question
 * is matched against those -- never against file names. Meaning alone misses
 * exact wording, though: "Theorem 4.2", "Heine-Borel", "Question 3(b)" are
 * matched on what they sound like rather than what they are. So a few more
 * candidates than needed are fetched, and a passage that contains the
 * question's own distinctive words or numbers -- in its heading especially --
 * is moved up. It costs no model call: it reads text the search returned.
 */

type Passage = { text: string; heading?: string; distance?: number };

const COMMON = new Set([
  "about", "above", "after", "again", "also", "because", "been", "before", "being", "between", "both",
  "could", "does", "doing", "each", "explain", "from", "have", "help", "into", "just", "like", "make",
  "more", "most", "much", "need", "only", "other", "over", "please", "question", "same", "should", "show",
  "some", "such", "than", "that", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "under", "very", "want", "what", "when", "where", "which", "while", "will", "with", "would",
  "your",
]);

/** The words and numbers in a question worth finding verbatim: long words, and anything with a digit. */
export function distinctiveTerms(query: string) {
  const words = query.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}][\p{L}\p{N}.'’-]*/gu) ?? [];
  const terms = words
    .map((word) => word.replace(/[.'’-]+$/u, ""))
    .filter((word) => (/\d/.test(word) ? word.length >= 1 : word.length >= 5) && !COMMON.has(word));
  return [...new Set(terms)].slice(0, 20);
}

/** How strongly a passage contains the question's own words: headings count double. */
function termScore(passage: Passage, terms: readonly string[]) {
  if (terms.length === 0) return 0;
  const body = passage.text.toLowerCase();
  const heading = (passage.heading ?? "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (heading.includes(term)) score += 2;
    else if (body.includes(term)) score += 1;
  }
  return score / (terms.length * 2);
}

/** How far a full match of the question's words can move a passage up, in cosine distance. */
const TERM_WEIGHT = 0.15;

export function rankRetrievedPassages<T extends Passage>(query: string, passages: readonly T[], limit: number): T[] {
  const terms = distinctiveTerms(query);
  return passages
    .map((passage) => ({ passage, score: (passage.distance ?? 1) - TERM_WEIGHT * termScore(passage, terms) }))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((entry) => entry.passage);
}
