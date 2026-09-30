import { describe, expect, it, vi } from "vitest";

/**
 * Searching a student's material for the passages that fit a question.
 *
 * Only the first fifteen attached sources used to be searched, so in a module
 * with thirty files the rest were never read however relevant they were.
 */
type Chunk = { id: string; sourceId: string; chunkIndex: number; text: string; distance: number };

const chunks: Chunk[] = [];
const filters: string[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/gemini-embeddings", () => ({
  createGeminiEmbedding: vi.fn(async () => [0.1, 0.2]),
  createGeminiEmbeddings: vi.fn(),
  getConfiguredGeminiEmbeddingApiKey: () => "key",
}));
vi.mock("@/lib/ai/provider-policy", () => ({ resolveAiProviderPolicy: () => ({ geminiReady: true }) }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminStorageBucket: vi.fn(),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: (id: string) => ({ get: async () => ({ exists: false, id }) }),
          where: (_field: string, _op: string, sourceIds: string[]) => {
            filters.push(sourceIds);
            return {
              findNearest: ({ limit }: { limit: number }) => ({
                get: async () => ({
                  docs: chunks
                    .filter((chunk) => sourceIds.includes(chunk.sourceId))
                    .sort((left, right) => left.distance - right.distance)
                    .slice(0, limit)
                    .map((chunk) => ({
                      id: chunk.id,
                      data: () => ({ ...chunk, vectorDistance: chunk.distance }),
                    })),
                }),
              }),
            };
          },
        }),
      }),
    }),
  }),
}));

const { retrieveSourceChunks } = await import("@/services/ai/source-index.server");

describe("finding the passages that fit a question", () => {
  it("searches every attached source and keeps the closest passages across all of them", async () => {
    const sourceIds = Array.from({ length: 45 }, (_, index) => `s${index + 1}`);
    chunks.push(
      ...sourceIds.map((sourceId, index) => ({
        id: `${sourceId}-0000`,
        sourceId,
        chunkIndex: 0,
        text: `Passage from ${sourceId}`,
        // The best matches are in the last files, which the old search never reached.
        distance: 1 - index / 100,
      }))
    );

    const found = await retrieveSourceChunks({
      uid: "u1",
      sourceIds,
      query: "compactness",
      limit: 3,
      includeNeighbors: false,
    });

    expect(filters.map((group) => group.length)).toEqual([30, 15]);
    expect(found.map((chunk) => chunk.sourceId)).toEqual(["s45", "s44", "s43"]);
  });
});

describe("ranking what the search found", () => {
  it("lifts a passage holding the question's exact terms over a merely similar one", async () => {
    const { distinctiveTerms, rankRetrievedPassages } = await import("@/lib/ai/source-passage-rank");
    expect(distinctiveTerms("Can you explain Theorem 4.2 on compactness please?")).toEqual(["theorem", "4.2", "compactness"]);

    const ranked = rankRetrievedPassages(
      "Explain Theorem 4.2 on compactness",
      [
        { id: "a", text: "Continuity of functions between metric spaces.", distance: 0.30 },
        { id: "b", text: "Every open cover has a finite subcover.", heading: "Theorem 4.2 (Compactness)", distance: 0.36 },
        { id: "c", text: "Unrelated revision timetable.", distance: 0.70 },
      ],
      2
    );
    expect(ranked.map((passage) => passage.id)).toEqual(["b", "a"]);
  });

  it("keeps the meaning order when the question has no distinctive words", async () => {
    const { rankRetrievedPassages } = await import("@/lib/ai/source-passage-rank");
    const ranked = rankRetrievedPassages("what is this about", [
      { id: "far", text: "x", distance: 0.5 },
      { id: "near", text: "y", distance: 0.2 },
    ], 2);
    expect(ranked.map((passage) => passage.id)).toEqual(["near", "far"]);
  });
});
