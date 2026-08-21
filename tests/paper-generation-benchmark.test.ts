import { describe, expect, it } from "vitest";
import {
  PAPER_GENERATION_BENCHMARK_CASE_KINDS,
  PAPER_GENERATION_BENCHMARK_DEFINITIONS,
  PAPER_GENERATION_BENCHMARK_REPETITIONS,
  buildPaperGenerationBenchmarkCaseId,
  expectedPaperGenerationBenchmarkCases,
} from "@/lib/practice/paper-generation-benchmark";

describe("paper-generation benchmark matrix", () => {
  it("freezes twelve distinct exact components and 108 cases", () => {
    expect(PAPER_GENERATION_BENCHMARK_DEFINITIONS).toHaveLength(12);
    expect(new Set(PAPER_GENERATION_BENCHMARK_DEFINITIONS.map((item) => item.id)).size).toBe(12);
    expect(new Set(PAPER_GENERATION_BENCHMARK_DEFINITIONS.map((item) => item.profileId)).size).toBe(12);
    expect(PAPER_GENERATION_BENCHMARK_CASE_KINDS).toHaveLength(3);
    expect(PAPER_GENERATION_BENCHMARK_REPETITIONS).toBe(3);
    expect(expectedPaperGenerationBenchmarkCases()).toBe(108);
  });

  it("creates stable collision-free case identifiers", () => {
    const ids = PAPER_GENERATION_BENCHMARK_DEFINITIONS.flatMap((definition) =>
      PAPER_GENERATION_BENCHMARK_CASE_KINDS.flatMap((kind) =>
        [1, 2, 3].map((repetition) => buildPaperGenerationBenchmarkCaseId(definition.id, kind, repetition))
      )
    );
    expect(ids).toHaveLength(108);
    expect(new Set(ids).size).toBe(108);
  });
});
