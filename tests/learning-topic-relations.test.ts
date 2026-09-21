import { describe, expect, it } from "vitest";
import {
  MAX_COVERED_CONCEPTS,
  applyTopicRelations,
  normalizeTopicSpecificationRelation,
  resolveTopicRelations,
} from "@/lib/learning/concepts/topic-relations";
import {
  buildConceptRegistry,
  conceptAncestors,
  expandConceptKeys,
  resolveConceptKey,
} from "@/lib/learning/concepts/registry";
import type { LearningConcept } from "@/lib/learning/types";

function spec(id: string, parentId?: string): LearningConcept {
  return {
    key: `spec:${id}`,
    label: id,
    source: "specification",
    provenance: "verified_specification",
    verified: true,
    ...(parentId ? { parentKey: `spec:${parentId}` } : {}),
  };
}

function studentTopic(id: string): LearningConcept {
  return {
    key: `topic:${id}`,
    label: id,
    source: "student-topic",
    provenance: "student_defined",
    verified: true,
  };
}

/** The AQA-shaped fixture used throughout: one spec topic, four concepts beneath it. */
const SPEC_CONCEPTS = [
  spec("algebra"),
  spec("completing-the-square", "algebra"),
  spec("factorisation", "algebra"),
  spec("discriminant", "algebra"),
  spec("quadratic-graphs", "algebra"),
];

function registryWith(
  relations: Parameters<typeof resolveTopicRelations>[0],
  extraConcepts: LearningConcept[] = []
) {
  const declared = [...SPEC_CONCEPTS, ...extraConcepts];
  const resolution = resolveTopicRelations(
    relations,
    declared.filter((concept) => concept.key.startsWith("spec:"))
  );
  return buildConceptRegistry({
    concepts: applyTopicRelations(declared, resolution),
    redirects: resolution.redirects,
  });
}

describe("reading a declared relation", () => {
  it("accepts the two shapes and nothing else", () => {
    expect(
      normalizeTopicSpecificationRelation({ type: "exact", conceptId: "osmosis", confirmedByOwner: true })
    ).toEqual({ type: "exact", conceptId: "osmosis", confirmedByOwner: true });
    expect(
      normalizeTopicSpecificationRelation({ type: "covers", conceptIds: ["a", "b"], confirmedByOwner: true })
    ).toEqual({ type: "covers", conceptIds: ["a", "b"], confirmedByOwner: true });

    expect(normalizeTopicSpecificationRelation(undefined)).toBeUndefined();
    expect(normalizeTopicSpecificationRelation({ type: "sort-of", conceptId: "a" })).toBeUndefined();
    expect(normalizeTopicSpecificationRelation({ type: "exact", conceptId: "  " })).toBeUndefined();
    expect(normalizeTopicSpecificationRelation({ type: "covers", conceptIds: [] })).toBeUndefined();
    expect(normalizeTopicSpecificationRelation({ type: "covers", conceptIds: "a" })).toBeUndefined();
  });

  it("treats an unstated confirmation as unconfirmed", () => {
    expect(
      normalizeTopicSpecificationRelation({ type: "exact", conceptId: "a" })?.confirmedByOwner
    ).toBe(false);
  });

  it("deduplicates and bounds a coverage list", () => {
    const many = Array.from({ length: MAX_COVERED_CONCEPTS + 10 }, (_, index) => `c${index}`);
    const relation = normalizeTopicSpecificationRelation({
      type: "covers",
      conceptIds: [...many, "c0", "c0"],
      confirmedByOwner: true,
    });
    expect(relation?.type === "covers" && relation.conceptIds.length).toBe(MAX_COVERED_CONCEPTS);
  });
});

describe("exact identity", () => {
  it("folds the Topic onto the concept it is declared to be", () => {
    const registry = registryWith(
      [
        {
          topicId: "cts",
          relation: { type: "exact", conceptId: "completing-the-square", confirmedByOwner: true },
        },
      ],
      [studentTopic("cts")]
    );
    expect(resolveConceptKey(registry, "topic:cts")).toBe("spec:completing-the-square");
  });

  it("refuses a relation the owner never confirmed", () => {
    const registry = registryWith(
      [
        {
          topicId: "cts",
          relation: { type: "exact", conceptId: "completing-the-square", confirmedByOwner: false },
        },
      ],
      [studentTopic("cts")]
    );
    expect(resolveConceptKey(registry, "topic:cts")).toBe("topic:cts");
  });

  it("refuses a concept this specification does not serve", () => {
    const registry = registryWith(
      [{ topicId: "cts", relation: { type: "exact", conceptId: "not-in-catalogue", confirmedByOwner: true } }],
      [studentTopic("cts")]
    );
    expect(resolveConceptKey(registry, "topic:cts")).toBe("topic:cts");
  });
});

describe("coverage", () => {
  const relations = [
    {
      topicId: "quadratics",
      relation: {
        type: "covers" as const,
        conceptIds: ["completing-the-square", "factorisation", "discriminant", "quadratic-graphs"],
        confirmedByOwner: true,
      },
    },
  ];

  it("makes the Topic the parent of what it covers", () => {
    const registry = registryWith(relations, [studentTopic("quadratics")]);
    expect(conceptAncestors(registry, "spec:completing-the-square")).toContain("topic:quadratics");
  });

  it("keeps the specification hierarchy above the Topic", () => {
    const registry = registryWith(relations, [studentTopic("quadratics")]);
    // spec:completing-the-square -> topic:quadratics -> spec:algebra
    expect(conceptAncestors(registry, "spec:completing-the-square")).toEqual([
      "topic:quadratics",
      "spec:algebra",
    ]);
  });

  it("never folds a covering Topic onto a concept", () => {
    const registry = registryWith(relations, [studentTopic("quadratics")]);
    expect(resolveConceptKey(registry, "topic:quadratics")).toBe("topic:quadratics");
  });

  it("never lets broad evidence reach a concept it covers", () => {
    const registry = registryWith(relations, [studentTopic("quadratics")]);
    const reached = expandConceptKeys(registry, ["topic:quadratics"]);
    expect(reached).toContain("topic:quadratics");
    expect(reached).toContain("spec:algebra");
    expect(reached).not.toContain("spec:completing-the-square");
    expect(reached).not.toContain("spec:factorisation");
    expect(reached).not.toContain("spec:discriminant");
  });

  it("lets fine evidence roll up to meet the broad Topic", () => {
    const registry = registryWith(relations, [studentTopic("quadratics")]);
    expect(expandConceptKeys(registry, ["spec:completing-the-square"])).toEqual(
      expect.arrayContaining([
        "spec:completing-the-square",
        "topic:quadratics",
        "spec:algebra",
      ])
    );
  });

  it("leaves a Topic top-level when what it covers disagrees on a parent", () => {
    const registry = registryWith(
      [
        {
          topicId: "mixed",
          relation: {
            type: "covers",
            conceptIds: ["completing-the-square", "osmosis"],
            confirmedByOwner: true,
          },
        },
      ],
      [studentTopic("mixed"), spec("osmosis", "biology"), spec("biology")]
    );
    expect(conceptAncestors(registry, "topic:mixed")).toEqual([]);
    expect(conceptAncestors(registry, "spec:completing-the-square")).toContain("topic:mixed");
  });

  it("gives a contested concept to one Topic, the same one every time", () => {
    const contested = [
      {
        topicId: "zeta",
        relation: { type: "covers" as const, conceptIds: ["factorisation"], confirmedByOwner: true },
      },
      {
        topicId: "alpha",
        relation: { type: "covers" as const, conceptIds: ["factorisation"], confirmedByOwner: true },
      },
    ];
    const first = resolveTopicRelations(contested, SPEC_CONCEPTS);
    const reversed = resolveTopicRelations([...contested].reverse(), SPEC_CONCEPTS);
    expect(first.coveredBy["spec:factorisation"]).toBe("topic:alpha");
    expect(reversed.coveredBy).toEqual(first.coveredBy);
  });
});

describe("guards", () => {
  it("breaks a cycle rather than looping", () => {
    // A Topic declared to cover a concept that is its own ancestor.
    const registry = registryWith(
      [
        {
          topicId: "loop",
          relation: { type: "covers", conceptIds: ["algebra"], confirmedByOwner: true },
        },
      ],
      [{ ...studentTopic("loop"), parentKey: "spec:algebra" }]
    );
    expect(() => conceptAncestors(registry, "spec:algebra")).not.toThrow();
    expect(conceptAncestors(registry, "spec:algebra").length).toBeLessThan(8);
  });

  it("does nothing at all when no relation is declared", () => {
    const plain = buildConceptRegistry({ concepts: [...SPEC_CONCEPTS, studentTopic("quadratics")] });
    const viaRelations = registryWith([], [studentTopic("quadratics")]);
    expect(Array.from(viaRelations.concepts.keys()).sort()).toEqual(
      Array.from(plain.concepts.keys()).sort()
    );
    expect(conceptAncestors(viaRelations, "spec:completing-the-square")).toEqual(
      conceptAncestors(plain, "spec:completing-the-square")
    );
  });
});
