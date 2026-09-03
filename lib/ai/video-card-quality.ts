/**
 * Whether a generated card is worth putting in front of a student.
 *
 * The generator already refuses cards that cite no evidence, but citing
 * evidence is not the same as agreeing with it: a card can name a real
 * timestamp and still assert something nobody said there. These are the
 * deterministic checks that run before any second opinion is paid for --
 * cheap, repeatable, and answerable in a test.
 *
 * Nothing here is clever enough to judge meaning. It judges overlap, which is
 * why a failure flags a card for another look rather than deleting it.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "his",
  "was", "one", "our", "out", "day", "get", "has", "him", "how", "its", "may",
  "new", "now", "old", "see", "two", "who", "boy", "did", "she", "use", "way",
  "that", "this", "with", "from", "they", "have", "were", "been", "their",
  "what", "when", "which", "will", "would", "there", "these", "than", "them",
  "then", "into", "also", "such", "more", "most", "some", "only", "does",
  "about", "because", "where", "while", "your", "here", "very", "just",
]);

/** Comparable form of a piece of card text: lowercase words, nothing else. */
export function normalizeForCompare(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The words in a string that carry any content.
 *
 * Short words and stopwords are dropped because they match everything, which
 * would make every card look supported by every piece of evidence. Numbers are
 * kept whatever their length -- in a lesson, "37" is usually the whole point.
 */
export function contentTokens(value: string) {
  const tokens = normalizeForCompare(value).split(" ").filter(Boolean);
  return new Set(
    tokens.filter((token) => !STOPWORDS.has(token) && (token.length >= 3 || /^[0-9]+$/.test(token)))
  );
}

/** How much of `subject` appears in `reference`, from 0 to 1. */
export function overlapRatio(subject: Set<string>, reference: Set<string>) {
  if (!subject.size) return 0;
  let shared = 0;
  for (const token of subject) if (reference.has(token)) shared += 1;
  return shared / subject.size;
}

/**
 * How much of the shorter of two token sets appears in the longer.
 *
 * Symmetric similarity is the wrong measure for card text, in both directions.
 * Questions are short, so "What is osmosis?" against "Define osmosis" scores one
 * shared word out of two and reads as unrelated. Answers are the opposite
 * problem: the fuller of two duplicate answers is penalised for the very detail
 * that makes it the one worth keeping. Containment sees one sitting inside the
 * other, which is what actually makes them the same card.
 */
export function containment(a: Set<string>, b: Set<string>) {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  if (!smaller.size) return 0;
  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared += 1;
  return shared / smaller.size;
}

export type EvidenceLike = { id: string; summary: string; facts: string[] };
export type CardLike = { id: string; front: string; back: string; evidenceIds: string[] };

/**
 * Below this, the card's answer has almost no words in common with the
 * evidence it cites. Set low on purpose: paraphrase is normal and legitimate,
 * so this is meant to catch a card that wandered off, not to enforce quoting.
 */
export const EVIDENCE_SUPPORT_FLOOR = 0.18;

/**
 * A duplicate is two cards asking the same question and giving the same
 * answer, and it takes both halves to tell.
 *
 * Comparing the two as one blob does not work: a batch of cards built on the
 * same sentence frame ("What does X depend on?") looks near-identical that way
 * even when every card is about a different X, and merging those loses real
 * content. Requiring the question to be contained in the other question, and
 * the answers to genuinely overlap, catches "What is osmosis?" against "Define
 * osmosis" while leaving a shared template alone.
 */
export const DUPLICATE_FRONT_CONTAINMENT = 0.8;
export const DUPLICATE_BACK_CONTAINMENT = 0.7;

/** The fewest content words an answer can have and still be an answer. */
const MIN_BACK_TOKENS = 3;

export function indexEvidence(evidence: EvidenceLike[]) {
  return new Map(evidence.map((entry) => [entry.id, entry]));
}

/**
 * How much of a card's answer is echoed by the evidence it cites.
 *
 * Evidence contributes both its summary and its facts, because a card may
 * legitimately draw on either. A card citing nothing resolvable scores zero.
 */
export function measureEvidenceSupport(card: CardLike, evidenceById: Map<string, EvidenceLike>) {
  const cited = card.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean) as EvidenceLike[];
  if (!cited.length) return 0;
  const reference = contentTokens(cited.map((entry) => `${entry.summary} ${entry.facts.join(" ")}`).join(" "));
  return overlapRatio(contentTokens(card.back), reference);
}

/**
 * An answer that does not answer anything.
 *
 * Two ways to fail: too few content words to say something ("Yes."), or every
 * word already present in the question, which restates the prompt rather than
 * resolving it.
 */
export function hasSubstantiveBack(card: CardLike) {
  const back = contentTokens(card.back);
  if (back.size < MIN_BACK_TOKENS) return false;
  return overlapRatio(back, contentTokens(card.front)) < 1;
}

/**
 * Drops cards that repeat one already kept, preferring the better-supported of
 * the pair. Comparison is on the question and the answer together, so two
 * cards asking the same thing with genuinely different answers both survive.
 */
export function dedupeNearDuplicates<T extends CardLike>(
  cards: T[],
  evidenceById: Map<string, EvidenceLike>
) {
  type Entry = { card: T; front: Set<string>; back: Set<string>; support: number };
  const kept: Entry[] = [];
  const removed: T[] = [];

  for (const card of cards) {
    const entry: Entry = {
      card,
      front: contentTokens(card.front),
      back: contentTokens(card.back),
      support: measureEvidenceSupport(card, evidenceById),
    };
    const clash = kept.findIndex(
      (other) =>
        containment(other.front, entry.front) >= DUPLICATE_FRONT_CONTAINMENT &&
        containment(other.back, entry.back) >= DUPLICATE_BACK_CONTAINMENT
    );

    if (clash === -1) {
      kept.push(entry);
      continue;
    }
    // Keep whichever of the pair the evidence backs more closely.
    if (entry.support > kept[clash].support) {
      removed.push(kept[clash].card);
      kept[clash] = entry;
    } else {
      removed.push(card);
    }
  }

  return { kept: kept.map((entry) => entry.card), removed };
}

/**
 * Splits a batch into cards the evidence supports and cards it does not.
 *
 * Unsupported cards are not thrown away here -- they are what the second look
 * at the video is for. Only an answer with no substance is hopeless enough to
 * drop outright, since no amount of re-reading rescues "Yes."
 */
export function partitionByEvidenceSupport<T extends CardLike>(
  cards: T[],
  evidenceById: Map<string, EvidenceLike>
) {
  const supported: T[] = [];
  const weak: T[] = [];
  const empty: T[] = [];

  for (const card of cards) {
    if (!hasSubstantiveBack(card)) empty.push(card);
    else if (measureEvidenceSupport(card, evidenceById) >= EVIDENCE_SUPPORT_FLOOR) supported.push(card);
    else weak.push(card);
  }

  return { supported, weak, empty };
}

/**
 * Ranks a batch best-first, for when there are more cards than the coverage
 * asked for. Trimming the least-grounded is better than failing the import or
 * cutting wherever the array happened to end.
 */
export function rankBySupport<T extends CardLike>(cards: T[], evidenceById: Map<string, EvidenceLike>) {
  return cards
    .map((card, index) => ({ card, index, support: measureEvidenceSupport(card, evidenceById) }))
    .sort((a, b) => b.support - a.support || a.index - b.index)
    .map((entry) => entry.card);
}

/**
 * A timestamp that lands inside the video.
 *
 * Nothing checked this before, so a hallucinated number became a card label --
 * and, now that a timestamp is something a student can click, it would seek
 * past the end of the recording.
 */
export function clampTimestamp(value: unknown, durationSeconds: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const positive = Math.max(0, value);
  return durationSeconds > 0 ? Math.min(positive, durationSeconds) : positive;
}
