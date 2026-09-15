import type { ConceptRegistry } from "@/lib/learning/concepts/registry";
import type { LearningTopicSource } from "@/lib/learning/types";
import { getTopicNameKey } from "@/lib/material/topics";

export type ConceptNameResolution =
  | { status: "resolved"; key: string; matchedBy: "label" | "alias" }
  | { status: "ambiguous"; keys: string[] }
  | { status: "unresolved" };

/**
 * Which concept a piece of free text names, if exactly one.
 *
 * The same normalisation Topics already use to stop duplicates, so "Completing
 * the square" and "completing  the Square" are one name. A label match beats an
 * alias match. More than one match is reported as ambiguous with every
 * candidate, and no match as unresolved -- never a best guess, because a wrong
 * concept silently attaches evidence to the wrong place.
 */
export function resolveConceptName(
  registry: ConceptRegistry,
  name: string,
  options: { sources?: readonly LearningTopicSource[] } = {}
): ConceptNameResolution {
  const wanted = getTopicNameKey(name);
  if (!wanted) return { status: "unresolved" };
  const candidates = Array.from(registry.concepts.values()).filter(
    (concept) => !options.sources || options.sources.includes(concept.source)
  );

  const byLabel = candidates
    .filter((concept) => getTopicNameKey(concept.label) === wanted)
    .map((concept) => concept.key)
    .sort();
  if (byLabel.length === 1 && byLabel[0]) return { status: "resolved", key: byLabel[0], matchedBy: "label" };
  if (byLabel.length > 1) return { status: "ambiguous", keys: byLabel };

  const byAlias = candidates
    .filter((concept) => (concept.aliases ?? []).some((alias) => getTopicNameKey(alias) === wanted))
    .map((concept) => concept.key)
    .sort();
  if (byAlias.length === 1 && byAlias[0]) return { status: "resolved", key: byAlias[0], matchedBy: "alias" };
  if (byAlias.length > 1) return { status: "ambiguous", keys: byAlias };
  return { status: "unresolved" };
}
