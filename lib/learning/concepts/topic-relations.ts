import type { LearningConcept } from "@/lib/learning/types";

/**
 * How a student's own Topic relates to the specification.
 *
 * A student writes "Quadratics" on a folder. The exam board writes five
 * numbered concepts: factorisation, completing the square, the discriminant,
 * graphs, solving. Until now those were unrelated concepts as far as the
 * profile was concerned, so flashcard evidence and past-paper evidence about
 * the same material never met.
 *
 * The obvious fix is wrong. Folding "Quadratics" onto all five would make one
 * flashcard count as evidence about completing the square, the discriminant
 * and three more things the student was never asked. That is not joining
 * evidence; it is inventing it.
 *
 * So there are two relations, and they behave differently:
 *
 * - `exact`: the Topic *is* that concept, one for one. Safe to treat as one
 *   key, which is what the registry's redirect map already does for Topics
 *   merged into one another.
 * - `covers`: the Topic is *broader than* those concepts. Evidence tagged with
 *   the Topic stays at the Topic. Evidence tagged with one of the concepts
 *   counts there and rolls up. Nothing flows down.
 *
 * The second relation needs no scoring of its own: `expandConceptKeys` already
 * expands upward only, so expressing coverage as parentage is enough, and the
 * cycle-breaking and depth limits in `buildConceptRegistry` apply unchanged.
 *
 * Both are assertions a person made and can withdraw. Neither is ever inferred
 * by a model: an unconfirmed relation takes no part, so a suggestion sitting in
 * a review queue cannot quietly become the thing the profile believes.
 *
 * The flag is called `confirmedByOwner` rather than `verified` because that is
 * precisely what it means: the person who owns this material said so on
 * purpose. A Topic lives in the student's own subtree and they may write any
 * field on it, so this is not a server-side verification and must not be read
 * as one. What it separates is a deliberate statement from a draft, which is
 * the distinction that matters -- the thing being kept out is an AI suggestion
 * stored for review and never confirmed. Someone mis-stating their own
 * syllabus mis-describes their own evidence, and the relation is reversible
 * for exactly that reason.
 */

export type TopicSpecificationRelation =
  | { type: "exact"; conceptId: string; confirmedByOwner: boolean }
  | { type: "covers"; conceptIds: string[]; confirmedByOwner: boolean };

/** More than a student would ever reasonably declare; a guard, not a design limit. */
export const MAX_COVERED_CONCEPTS = 24;

function readId(value: unknown, maxLength = 160) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id.length > 0 && id.length <= maxLength ? id : "";
}

/**
 * A stored relation, or undefined for anything malformed.
 *
 * Read defensively: this is student-or-owner data that decides how evidence is
 * attributed, and a half-written relation must not silently attribute it
 * somewhere plausible-looking.
 */
export function normalizeTopicSpecificationRelation(
  value: unknown
): TopicSpecificationRelation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const confirmedByOwner = record.confirmedByOwner === true;

  if (record.type === "exact") {
    const conceptId = readId(record.conceptId);
    return conceptId ? { type: "exact", conceptId, confirmedByOwner } : undefined;
  }

  if (record.type === "covers") {
    if (!Array.isArray(record.conceptIds)) return undefined;
    const conceptIds = Array.from(
      new Set(record.conceptIds.map((entry) => readId(entry)).filter(Boolean))
    ).slice(0, MAX_COVERED_CONCEPTS);
    return conceptIds.length > 0 ? { type: "covers", conceptIds, confirmedByOwner } : undefined;
  }

  return undefined;
}

export type TopicRelationInput = {
  /** The student Topic's own id, without the `topic:` prefix. */
  topicId: string;
  relation: TopicSpecificationRelation;
};

export type TopicRelationResolution = {
  /** `topic:<id>` → `spec:<id>`, for the registry's redirect map. */
  redirects: Record<string, string>;
  /**
   * `spec:<id>` → `topic:<id>`: the covered concept's new parent.
   *
   * Applied over a concept that already has a specification parent, so the
   * covering Topic is inserted into the hierarchy rather than detaching the
   * concept from it. See `coveringTopicParents`.
   */
  coveredBy: Record<string, string>;
  /**
   * `topic:<id>` → `spec:<id>`: where a covering Topic itself hangs.
   *
   * A Topic that covers concepts sits where those concepts sat, so the chain
   * stays whole: `spec:completing-the-square` → `topic:quadratics` →
   * `spec:algebra`. When the covered concepts do not agree on a parent, the
   * Topic is left at the top rather than being assigned an arbitrary one.
   */
  coveringTopicParents: Record<string, string>;
};

const EMPTY_RESOLUTION: TopicRelationResolution = {
  redirects: {},
  coveredBy: {},
  coveringTopicParents: {},
};

/**
 * Turn declared relations into the three things the registry needs.
 *
 * Only confirmed relations take part. A relation naming a concept the folder's
 * catalogue does not serve is dropped: a Topic cannot be declared equal to
 * something this student's specification has never heard of.
 *
 * `specConcepts` supplies the existing hierarchy so a covering Topic can
 * inherit its covered concepts' parent.
 */
export function resolveTopicRelations(
  relations: readonly TopicRelationInput[],
  specConcepts: readonly Pick<LearningConcept, "key" | "parentKey">[]
): TopicRelationResolution {
  if (relations.length === 0) return EMPTY_RESOLUTION;

  const parentOfSpec = new Map<string, string | undefined>(
    specConcepts.map((concept) => [concept.key, concept.parentKey])
  );

  const redirects: Record<string, string> = {};
  const coveredBy: Record<string, string> = {};
  const coveringTopicParents: Record<string, string> = {};

  // Deterministic: a covered concept claimed by two Topics goes to the first by id.
  const ordered = [...relations].sort((left, right) => left.topicId.localeCompare(right.topicId));

  for (const { topicId, relation } of ordered) {
    if (!relation.confirmedByOwner) continue;
    const topicKey = `topic:${readId(topicId)}`;
    if (topicKey === "topic:") continue;

    if (relation.type === "exact") {
      const conceptKey = `spec:${relation.conceptId}`;
      if (!parentOfSpec.has(conceptKey)) continue;
      redirects[topicKey] = conceptKey;
      continue;
    }

    const covered = relation.conceptIds
      .map((conceptId) => `spec:${conceptId}`)
      .filter((conceptKey) => parentOfSpec.has(conceptKey) && !coveredBy[conceptKey]);
    if (covered.length === 0) continue;

    for (const conceptKey of covered) coveredBy[conceptKey] = topicKey;

    /*
     * The Topic takes its covered concepts' parent, so the specification
     * hierarchy above it survives. Concepts pulled from different parts of the
     * specification agree on nothing, so the Topic stays top-level instead.
     */
    const parents = new Set(
      covered.map((conceptKey) => parentOfSpec.get(conceptKey)).filter(Boolean) as string[]
    );
    const inherited = parents.size === 1 ? Array.from(parents)[0] : undefined;
    if (inherited && inherited !== topicKey) coveringTopicParents[topicKey] = inherited;
  }

  return { redirects, coveredBy, coveringTopicParents };
}

/**
 * Lay a resolution over the concepts a profile was going to reason with.
 *
 * Returns concepts only; redirects are handed to `buildConceptRegistry`
 * separately because that is where a redirected key is resolved.
 */
export function applyTopicRelations(
  concepts: readonly LearningConcept[],
  resolution: TopicRelationResolution
): LearningConcept[] {
  const { coveredBy, coveringTopicParents, redirects } = resolution;
  if (
    Object.keys(coveredBy).length === 0 &&
    Object.keys(coveringTopicParents).length === 0 &&
    Object.keys(redirects).length === 0
  ) {
    return [...concepts];
  }
  return concepts
    /*
     * A Topic declared to *be* a concept stops existing as one of its own.
     * It is not two things that point at each other: it is one thing with two
     * names, and the specification's name is the one that survives. A redirect
     * whose source is still a concept is ignored by the registry anyway, so
     * leaving it in would silently do nothing.
     */
    .filter((concept) => !redirects[concept.key])
    .map((concept) => {
      const covered = coveredBy[concept.key];
      if (covered) return { ...concept, parentKey: covered };
      const covering = coveringTopicParents[concept.key];
      if (covering) return { ...concept, parentKey: covering };
      return concept;
    });
}
