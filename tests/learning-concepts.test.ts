import { describe, expect, it } from "vitest";
import {
  buildConceptRegistry,
  buildDescendantIndex,
  conceptAncestors,
  conceptShares,
  expandConceptKeys,
  isProductionConcept,
  resolveConceptKey,
} from "@/lib/learning/concepts/registry";
import { resolveConceptName } from "@/lib/learning/concepts/resolve-name";
import type { LearningConcept } from "@/lib/learning/types";

/**
 * Concept identity: what the engine is allowed to reason about, and how.
 *
 * A key is identity, a label is not. Drafts never become truth by being
 * loaded. Hierarchies come from data a student can get wrong, so cycles and
 * missing parents must fail safe and deterministically. Free text resolves to
 * a concept only when it names exactly one.
 */

function concept(key: string, overrides: Partial<LearningConcept> = {}): LearningConcept {
  return {
    key,
    label: key.replace(/^\w+:/, ""),
    source: "student-topic",
    provenance: "student_defined",
    verified: true,
    ...overrides,
  };
}

describe("the concept registry", () => {
  it("admits checked and student concepts, never drafts", () => {
    expect(isProductionConcept({ provenance: "verified_specification", verified: true })).toBe(true);
    expect(isProductionConcept({ provenance: "verified_specification", verified: false })).toBe(false);
    expect(isProductionConcept({ provenance: "jami_curated", verified: false })).toBe(false);
    expect(isProductionConcept({ provenance: "student_defined", verified: false })).toBe(true);
    expect(isProductionConcept({ provenance: "fallback", verified: false })).toBe(true);
    expect(isProductionConcept({ provenance: "ai_suggested", verified: true })).toBe(false);

    const registry = buildConceptRegistry({
      concepts: [
        concept("topic:real"),
        concept("spec:draft", { source: "specification", provenance: "ai_suggested", verified: false }),
      ],
    });
    expect(Array.from(registry.concepts.keys())).toEqual(["topic:real"]);
  });

  it("lets a detailed concept replace a plain one with the same key", () => {
    const registry = buildConceptRegistry({
      concepts: [concept("topic:quadratics"), concept("topic:algebra"), concept("topic:quadratics", { parentKey: "topic:algebra" })],
    });
    expect(registry.concepts.get("topic:quadratics")?.parentKey).toBe("topic:algebra");
  });

  it("drops a parent that does not exist", () => {
    const registry = buildConceptRegistry({ concepts: [concept("topic:orphan", { parentKey: "topic:deleted" })] });
    expect(registry.concepts.get("topic:orphan")?.parentKey).toBeUndefined();
  });

  it("breaks a parent cycle the same way whatever order the data arrives in", () => {
    const cyclic = [
      concept("topic:a", { parentKey: "topic:c" }),
      concept("topic:b", { parentKey: "topic:a" }),
      concept("topic:c", { parentKey: "topic:b" }),
    ];
    const forward = buildConceptRegistry({ concepts: cyclic });
    const reversed = buildConceptRegistry({ concepts: [...cyclic].reverse() });

    expect(Array.from(forward.concepts.entries())).toEqual(Array.from(reversed.concepts.entries()));
    expect(forward.concepts.get("topic:a")?.parentKey).toBeUndefined();
    expect(conceptAncestors(forward, "topic:c")).toEqual(["topic:b", "topic:a"]);
  });

  it("follows merged concepts to where they went, and gives up on a loop", () => {
    const registry = buildConceptRegistry({
      concepts: [concept("topic:current")],
      redirects: { "topic:old": "topic:older", "topic:older": "topic:current", "topic:x": "topic:y", "topic:y": "topic:x" },
    });
    expect(resolveConceptKey(registry, "topic:old")).toBe("topic:current");
    expect(resolveConceptKey(registry, "topic:x")).toBeNull();
    expect(resolveConceptKey(registry, "topic:never-heard-of")).toBeNull();
  });

  it("counts a concept's evidence towards everything above it, and drops what it cannot resolve", () => {
    const registry = buildConceptRegistry({
      concepts: [
        concept("topic:maths"),
        concept("topic:algebra", { parentKey: "topic:maths" }),
        concept("topic:quadratics", { parentKey: "topic:algebra" }),
      ],
      redirects: { "topic:merged": "topic:quadratics" },
    });
    expect(expandConceptKeys(registry, ["topic:merged", "topic:unknown"]).sort()).toEqual([
      "topic:algebra",
      "topic:maths",
      "topic:quadratics",
    ]);
    expect(buildDescendantIndex(registry).get("topic:maths")).toEqual(["topic:algebra", "topic:quadratics"]);
  });
});

describe("resolving a concept by name", () => {
  const registry = buildConceptRegistry({
    concepts: [
      concept("spec:quadratic-equations", {
        label: "Solving quadratic equations",
        source: "specification",
        provenance: "verified_specification",
        aliases: ["Completing the square", "CTS"],
      }),
      concept("topic:mine", { label: "Completing the square" }),
      concept("topic:graphs-a", { label: "Graphs" }),
      concept("topic:graphs-b", { label: "graphs" }),
    ],
  });

  it("matches a label regardless of case and spacing", () => {
    expect(resolveConceptName(registry, "  solving   QUADRATIC equations ")).toEqual({
      status: "resolved",
      key: "spec:quadratic-equations",
      matchedBy: "label",
    });
  });

  it("prefers a label over an alias, and uses aliases when no label matches", () => {
    expect(resolveConceptName(registry, "Completing the square")).toMatchObject({ key: "topic:mine", matchedBy: "label" });
    expect(resolveConceptName(registry, "cts")).toMatchObject({ key: "spec:quadratic-equations", matchedBy: "alias" });
    expect(
      resolveConceptName(registry, "Completing the square", { sources: ["specification"] })
    ).toMatchObject({ key: "spec:quadratic-equations", matchedBy: "alias" });
  });

  it("reports ambiguity and absence instead of guessing", () => {
    expect(resolveConceptName(registry, "Graphs")).toEqual({
      status: "ambiguous",
      keys: ["topic:graphs-a", "topic:graphs-b"],
    });
    expect(resolveConceptName(registry, "Vectors")).toEqual({ status: "unresolved" });
    expect(resolveConceptName(registry, "   ")).toEqual({ status: "unresolved" });
  });
});

describe("sharing an answer between concepts", () => {
  const registry = buildConceptRegistry({
    concepts: [
      concept("topic:algebra"),
      concept("topic:quadratics", { parentKey: "topic:algebra" }),
      concept("topic:discriminants", { parentKey: "topic:quadratics" }),
      concept("topic:sequences", { parentKey: "topic:algebra" }),
      concept("topic:probability"),
    ],
    redirects: { "topic:old-sequences": "topic:sequences" },
  });

  it("is the whole answer for one concept, or one concept tagged with its own parent", () => {
    expect(conceptShares(registry, [])).toBeNull();
    expect(conceptShares(registry, ["topic:quadratics"])).toBeNull();
    expect(conceptShares(registry, ["topic:quadratics", "topic:algebra"])).toBeNull();
    expect(conceptShares(registry, ["topic:quadratics", "topic:deleted"])).toBeNull();
  });

  it("splits an answer between the concepts it tests and gives a parent everything beneath it", () => {
    expect(conceptShares(registry, ["topic:discriminants", "topic:old-sequences"])).toEqual({
      "topic:algebra": 1,
      "topic:discriminants": 0.5,
      "topic:quadratics": 0.5,
      "topic:sequences": 0.5,
    });
    expect(conceptShares(registry, ["topic:quadratics", "topic:sequences", "topic:probability"])).toEqual({
      "topic:algebra": 2 / 3,
      "topic:probability": 1 / 3,
      "topic:quadratics": 1 / 3,
      "topic:sequences": 1 / 3,
    });
  });

  it("gives every key the answer counts towards a share", () => {
    const keys = ["topic:discriminants", "topic:sequences", "topic:quadratics"];
    expect(Object.keys(conceptShares(registry, keys) ?? {}).sort()).toEqual(
      expandConceptKeys(registry, keys).sort()
    );
  });
});
