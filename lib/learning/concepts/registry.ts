import type { LearningConcept } from "@/lib/learning/types";

/**
 * The concepts one profile may reason over, and how they relate.
 *
 * Built fresh per profile from the concepts in scope. Only production concepts
 * enter: a checked catalogue entry, a student's own Topic, a deck fallback. An
 * AI-suggested or unchecked catalogue concept can be reviewed elsewhere but is
 * never evidence here, so a draft cannot quietly become truth by being loaded.
 */

/** Deeper than any real course hierarchy; a guard against malformed or cyclic data, not a design limit. */
export const MAX_CONCEPT_DEPTH = 8;

export type ConceptRegistry = {
  readonly concepts: ReadonlyMap<string, LearningConcept>;
  /** Old keys that now mean another concept, such as a Topic merged into another. */
  readonly redirects: ReadonlyMap<string, string>;
};

export function isProductionConcept(concept: Pick<LearningConcept, "provenance" | "verified">) {
  switch (concept.provenance) {
    case "ai_suggested":
      return false;
    case "verified_specification":
    case "jami_curated":
      return concept.verified;
    case "student_defined":
    case "fallback":
      return true;
  }
}

/**
 * A registry from concepts in any order.
 *
 * When two entries share a key the later one wins, so a caller can lay
 * detailed concepts over plain labels. A parent that is missing is dropped. A
 * parent cycle -- possible in student data, since a Topic's parent is just a
 * field -- is broken at its lowest key, so the result never depends on the
 * order the data arrived in.
 */
export function buildConceptRegistry(input: {
  concepts: readonly LearningConcept[];
  redirects?: Readonly<Record<string, string>>;
}): ConceptRegistry {
  const byKey = new Map<string, LearningConcept>();
  for (const concept of input.concepts) {
    if (!concept.key || !concept.label || !isProductionConcept(concept)) continue;
    byKey.set(concept.key, concept);
  }

  const parents = new Map<string, string>();
  for (const [key, concept] of byKey) {
    if (concept.parentKey && concept.parentKey !== key && byKey.has(concept.parentKey)) {
      parents.set(key, concept.parentKey);
    }
  }
  const keys = Array.from(byKey.keys()).sort();
  for (const key of keys) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = key;
    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      path.push(current);
      current = parents.get(current);
    }
    if (current !== undefined) {
      const cycle = path.slice(path.indexOf(current)).sort();
      const breakAt = cycle[0];
      if (breakAt !== undefined) parents.delete(breakAt);
    }
  }

  const concepts = new Map<string, LearningConcept>();
  for (const key of keys) {
    const concept = byKey.get(key);
    if (!concept) continue;
    const parentKey = parents.get(key);
    const { parentKey: _declared, ...rest } = concept;
    void _declared;
    concepts.set(key, parentKey ? { ...rest, parentKey } : rest);
  }

  const redirects = new Map<string, string>();
  for (const [from, to] of Object.entries(input.redirects ?? {})) {
    if (from && to && from !== to && !concepts.has(from)) redirects.set(from, to);
  }
  return { concepts, redirects };
}

/**
 * The concept a key refers to now, or null.
 *
 * Follows redirects -- a merged Topic's evidence counts towards the Topic it
 * was merged into -- and gives up on a chain that loops or runs too long. An
 * unknown key stays unknown: evidence that cannot be attributed is left
 * unattributed rather than guessed at.
 */
export function resolveConceptKey(registry: ConceptRegistry, key: string): string | null {
  let current = key;
  const seen = new Set<string>();
  for (let step = 0; step <= MAX_CONCEPT_DEPTH; step += 1) {
    if (registry.concepts.has(current)) return current;
    const next = registry.redirects.get(current);
    if (!next || seen.has(next)) return null;
    seen.add(current);
    current = next;
  }
  return null;
}

/** Broader concepts above this one, nearest first. */
export function conceptAncestors(registry: ConceptRegistry, key: string): string[] {
  const ancestors: string[] = [];
  let current = registry.concepts.get(key)?.parentKey;
  while (current && ancestors.length < MAX_CONCEPT_DEPTH && !ancestors.includes(current)) {
    ancestors.push(current);
    current = registry.concepts.get(current)?.parentKey;
  }
  return ancestors;
}

/**
 * The keys an observation or piece of material counts towards: each resolved
 * concept and everything above it. Keys that resolve to nothing are dropped.
 */
export function expandConceptKeys(registry: ConceptRegistry, keys: readonly string[]): string[] {
  const expanded = new Set<string>();
  for (const key of keys) {
    const resolved = resolveConceptKey(registry, key);
    if (!resolved) continue;
    expanded.add(resolved);
    conceptAncestors(registry, resolved).forEach((ancestor) => expanded.add(ancestor));
  }
  return Array.from(expanded);
}

/**
 * How much of an answer tagged with these keys is about each concept it counts
 * towards, or null when that is the whole answer for every one of them.
 *
 * Each distinct concept the answer tests gets an equal part, and a broader
 * concept gets the parts of everything it covers: an answer on quadratics and
 * sequences is half about each, and wholly about algebra above both. A key
 * tagged alongside its own parent adds nothing the child did not already say,
 * and a key that resolves to nothing takes no part.
 */
export function conceptShares(
  registry: ConceptRegistry,
  keys: readonly string[]
): Record<string, number> | null {
  const resolved = new Set<string>();
  for (const key of keys) {
    const concept = resolveConceptKey(registry, key);
    if (concept) resolved.add(concept);
  }
  const broader = new Set(Array.from(resolved).flatMap((key) => conceptAncestors(registry, key)));
  const tested = Array.from(resolved).filter((key) => !broader.has(key));
  if (tested.length < 2) return null;

  const covering = new Map<string, number>();
  for (const key of tested) {
    for (const concept of [key, ...conceptAncestors(registry, key)]) {
      covering.set(concept, (covering.get(concept) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    Array.from(covering.keys())
      .sort()
      .map((concept) => [concept, (covering.get(concept) ?? 0) / tested.length])
  );
}

/** Every concept beneath each parent, for finding the finer concepts under a broad one. */
export function buildDescendantIndex(registry: ConceptRegistry): Map<string, string[]> {
  const descendants = new Map<string, string[]>();
  for (const key of Array.from(registry.concepts.keys()).sort()) {
    for (const ancestor of conceptAncestors(registry, key)) {
      const list = descendants.get(ancestor) ?? [];
      list.push(key);
      descendants.set(ancestor, list);
    }
  }
  return descendants;
}
