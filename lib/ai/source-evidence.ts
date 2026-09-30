/**
 * What Tutor reads from a set of sources for one question.
 *
 * Tutor can be handed up to fifteen sources at once. Reading all of them whole
 * does not scale, and it was never what made answers good: a prompt stuffed
 * with every page of every source drowns the passage that matters and invites
 * the model to repeat the source back rather than teach from it. So each
 * source contributes the few passages the index says are relevant, the
 * sources share one budget fairly, and a source is read whole only when it
 * has no index to search.
 *
 * Pure: the route does the retrieval and the reading, and this decides what
 * goes in front of the model.
 */

import { SOURCE_INDEX_VERSION } from "@/lib/ai/source-chunking";
import { describePageRange, type SourcePageKind } from "@/lib/ai/source-outline";

type IndexedSourceState = {
  indexStatus?: "processing" | "ready" | "empty" | "failed";
  indexVersion?: number;
  indexChunkCount?: number;
  indexUpdatedAt?: number;
};

/** An index that stopped partway (a timed-out function) is retried after this. */
const STALLED_INDEX_MS = 15 * 60 * 1000;

/**
 * Whether a source's index can be searched for this question. One being
 * rebuilt still has its previous passages until the new ones replace them.
 */
export function isSourceIndexSearchable(source: IndexedSourceState) {
  return (
    source.indexStatus === "ready" ||
    (source.indexStatus === "processing" && (source.indexChunkCount ?? 0) > 0)
  );
}

/**
 * Whether Tutor should rebuild a source's index after answering, because the
 * student has just asked about it and its index is missing, from an older
 * format that lacks lecture labels and its later pages, or stuck.
 *
 * Each source is tried once per format: a failed or empty build records the
 * version it was tried with, so it is not retried on every question.
 */
export function sourceIndexNeedsRebuild(source: IndexedSourceState, now = Date.now()) {
  if (!source.indexStatus) return true;
  if (source.indexStatus === "processing") {
    return now - (source.indexUpdatedAt ?? 0) > STALLED_INDEX_MS;
  }
  return (source.indexVersion ?? 1) < SOURCE_INDEX_VERSION;
}

/** Characters of retrieved passages one question may carry, across every source. */
export const TUTOR_EVIDENCE_CHARACTER_BUDGET = 48_000;

/**
 * Sources read whole, per question, when they have no index to search.
 *
 * Reading a file whole can mean a vision call to understand it, so this is the
 * bound on that work rather than a bound on how many sources a student can
 * choose. Deliberately chosen sources are read first.
 */
export const MAX_WHOLE_SOURCE_READS = 5;

/** The most passages any one source contributes, however few sources there are. */
const MAX_PASSAGES_PER_SOURCE = 8;
/**
 * The most a source contributes when the student named the part of it they
 * mean: enough for most of one lecture, read in order.
 */
const MAX_TARGETED_PASSAGES_PER_SOURCE = 14;

export type EvidenceSource = {
  id: string;
  /** Chosen by the student or attached to what they are working on, rather than found by relation. */
  pinned: boolean;
  /** The source has a searchable index, so finding nothing in it means nothing relevant. */
  indexed: boolean;
};

export type EvidencePassage = {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  heading?: string;
  /** The lecture, week or chapter the passage belongs to, e.g. "Lecture 4: Entropy". */
  sectionLabel?: string;
  /** What the source's page numbers count. */
  pageKind?: SourcePageKind;
  /** Cosine distance to the question; lower is closer. Absent for a neighbouring passage. */
  distance?: number;
  /** From a part of the source the student named or plainly asked about. */
  targeted?: boolean;
};

export type SourceEvidencePlan =
  | { sourceId: string; kind: "passages"; passages: EvidencePassage[] }
  | { sourceId: string; kind: "whole" }
  | { sourceId: string; kind: "skip"; reason: "not_relevant" | "whole_read_limit" };

/**
 * How many passages to ask the index for, per pinned source.
 *
 * One source gets a thorough search; fifteen get two each, so a broad question
 * across many sources still hears from every one of them.
 */
export function getPinnedPassageLimit(pinnedCount: number) {
  if (pinnedCount <= 1) return MAX_PASSAGES_PER_SOURCE;
  if (pinnedCount <= 3) return 5;
  if (pinnedCount <= 6) return 3;
  return 2;
}

/** How many passages related sources compete for, together. */
export function getRelatedPassageLimit(relatedCount: number) {
  return relatedCount <= 0 ? 0 : Math.min(12, Math.max(4, relatedCount * 2));
}

function byCloseness(left: EvidencePassage, right: EvidencePassage) {
  return (
    Number(Boolean(right.targeted)) - Number(Boolean(left.targeted)) ||
    (left.distance ?? Number.POSITIVE_INFINITY) -
      (right.distance ?? Number.POSITIVE_INFINITY) ||
    left.chunkIndex - right.chunkIndex
  );
}

/**
 * Decides, for every source, whether it contributes passages, is read whole,
 * or is left out.
 *
 * Passages are dealt round-robin -- every source's closest passage first, then
 * every source's second -- so one long, closely matching source cannot fill
 * the budget before the others are heard. Pinned sources are dealt before
 * related ones in each round. Within a source, the passages go back into
 * reading order so the model sees an argument rather than a shuffle.
 *
 * `retrievalFailed` means the index could not be searched at all, so no source
 * can be judged irrelevant from an empty result.
 */
export function planSourceEvidence(input: {
  sources: readonly EvidenceSource[];
  passages: readonly EvidencePassage[];
  retrievalFailed?: boolean;
  characterBudget?: number;
}): SourceEvidencePlan[] {
  const budget = input.characterBudget ?? TUTOR_EVIDENCE_CHARACTER_BUDGET;
  const knownIds = new Set(input.sources.map((source) => source.id));
  const queues = new Map<string, EvidencePassage[]>();
  const seen = new Set<string>();
  for (const passage of input.passages) {
    if (!knownIds.has(passage.sourceId) || !passage.text.trim() || seen.has(passage.id)) continue;
    seen.add(passage.id);
    const queue = queues.get(passage.sourceId) ?? [];
    queue.push(passage);
    queues.set(passage.sourceId, queue);
  }
  queues.forEach((queue) => queue.sort(byCloseness));

  const targetedCount = (sourceId: string) =>
    queues.get(sourceId)?.filter((passage) => passage.targeted).length ?? 0;
  const capFor = (sourceId: string) => {
    const targeted = targetedCount(sourceId);
    return targeted > 0
      ? Math.min(MAX_TARGETED_PASSAGES_PER_SOURCE, Math.max(MAX_PASSAGES_PER_SOURCE, targeted + 2))
      : MAX_PASSAGES_PER_SOURCE;
  };
  // A source the student pointed into goes first: what they named is what
  // they are asking about.
  const order = [...input.sources].sort(
    (left, right) =>
      Number(targetedCount(right.id) > 0) - Number(targetedCount(left.id) > 0) ||
      Number(right.pinned) - Number(left.pinned) ||
      (queues.get(left.id)?.[0]?.distance ?? Number.POSITIVE_INFINITY) -
        (queues.get(right.id)?.[0]?.distance ?? Number.POSITIVE_INFINITY)
  );

  const chosen = new Map<string, EvidencePassage[]>();
  let remaining = budget;
  for (let round = 0; round < MAX_TARGETED_PASSAGES_PER_SOURCE && remaining > 0; round += 1) {
    let dealt = false;
    for (const source of order) {
      if (round >= capFor(source.id)) continue;
      const next = queues.get(source.id)?.[round];
      if (!next) continue;
      // The first passage of each source is always dealt, so a source that was
      // found relevant is never dropped for arriving late in the order; the
      // budget bounds the rounds after it.
      if (round > 0 && next.text.length > remaining) continue;
      chosen.set(source.id, [...(chosen.get(source.id) ?? []), next]);
      remaining -= next.text.length;
      dealt = true;
    }
    if (!dealt) break;
  }

  let wholeReads = 0;
  const plans = new Map<string, SourceEvidencePlan>();
  for (const source of order) {
    const passages = chosen.get(source.id);
    if (passages?.length) {
      plans.set(source.id, {
        sourceId: source.id,
        kind: "passages",
        passages: [...passages].sort((left, right) => left.chunkIndex - right.chunkIndex),
      });
      continue;
    }
    // An indexed source the search found nothing in has nothing to add. A
    // failed search proves nothing, so it falls through to a whole read.
    if (source.indexed && !input.retrievalFailed) {
      plans.set(source.id, { sourceId: source.id, kind: "skip", reason: "not_relevant" });
      continue;
    }
    if (wholeReads >= MAX_WHOLE_SOURCE_READS) {
      plans.set(source.id, { sourceId: source.id, kind: "skip", reason: "whole_read_limit" });
      continue;
    }
    wholeReads += 1;
    plans.set(source.id, { sourceId: source.id, kind: "whole" });
  }

  // Back in the order the sources were given, so S-references stay stable.
  return input.sources.flatMap((source) => {
    const plan = plans.get(source.id);
    return plan ? [plan] : [];
  });
}

function describeLocation(passage: EvidencePassage) {
  const pages = describePageRange(passage.pageStart, passage.pageEnd, passage.pageKind);
  const heading =
    passage.heading && passage.heading !== passage.sectionLabel ? passage.heading : "";
  return [passage.sectionLabel, pages, heading].filter(Boolean).join(" · ") || "Extract";
}

/**
 * The passages as the model reads them, after the source's contents list when
 * it has one.
 *
 * Headed as material to understand rather than text to reproduce, because the
 * framing a passage arrives in is a large part of whether it comes back out
 * verbatim. Each is labelled with where it sits in the student's material, so
 * Tutor can tell them where to look.
 */
export function formatEvidencePassages(
  passages: readonly EvidencePassage[],
  options: { outline?: string } = {}
) {
  return [
    options.outline ?? "",
    "Passages the search judged relevant to this question, each labelled with where it is in the source. They are for your understanding: teach the ideas in your own words rather than reproducing these sentences.",
    ...passages.map((passage) => `[${describeLocation(passage)}]\n${passage.text.trim()}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The window a copied run must at least span to count at all. */
const SHINGLE_WORDS = 8;

/**
 * The longest run of words the answer shares, in order, with any evidence text.
 *
 * Zero when nothing of eight words or more matches. Punctuation and case are
 * ignored, so a sentence lifted with its commas dropped still counts. This is
 * how "it just quoted the source" is measured rather than guessed at.
 */
export function longestCopiedRun(answer: string, evidence: readonly string[]) {
  const shingles = new Set<string>();
  for (const text of evidence) {
    const tokens = words(text);
    for (let start = 0; start + SHINGLE_WORDS <= tokens.length; start += 1) {
      shingles.add(tokens.slice(start, start + SHINGLE_WORDS).join(" "));
    }
  }
  if (shingles.size === 0) return 0;

  const tokens = words(answer);
  let longest = 0;
  let consecutive = 0;
  for (let start = 0; start + SHINGLE_WORDS <= tokens.length; start += 1) {
    if (shingles.has(tokens.slice(start, start + SHINGLE_WORDS).join(" "))) {
      consecutive += 1;
      longest = Math.max(longest, SHINGLE_WORDS + consecutive - 1);
    } else {
      consecutive = 0;
    }
  }
  return longest;
}
