import { describe, expect, it } from "vitest";
import {
  buildEmbeddingDocumentText,
  buildEmbeddingQueryText,
  chunkSourcePages,
  SOURCE_CHUNK_MAX_CHARACTERS,
} from "@/lib/ai/source-chunking";

describe("private source index chunking", () => {
  it("keeps page boundaries and caps chunk size", () => {
    const paragraph = "A complete sentence about enzyme activity. ".repeat(140);
    const chunks = chunkSourcePages([
      { pageNumber: 4, heading: "Enzymes", text: paragraph },
      { pageNumber: 5, text: "Temperature changes reaction rate." },
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= SOURCE_CHUNK_MAX_CHARACTERS)).toBe(true);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, pageStart: 4, heading: "Enzymes" });
    expect(chunks.at(-1)?.pageEnd).toBe(5);
  });

  it("uses the asymmetric Gemini Embedding 2 retrieval prefixes", () => {
    const [chunk] = chunkSourcePages([{ pageNumber: 2, text: "Mitosis produces two cells." }]);
    expect(buildEmbeddingDocumentText("Cell biology", chunk)).toContain(
      "title: Cell biology (page 2) | text:"
    );
    expect(buildEmbeddingQueryText("What does mitosis produce?")).toBe(
      "task: question answering | query: What does mitosis produce?"
    );
  });

  it("carries inferred headings into the following chunk", () => {
    const chunks = chunkSourcePages([{
      pageNumber: 3,
      text: "## Photosynthesis\n\nPlants convert light energy into chemical energy in chloroplasts.",
    }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      pageStart: 3,
      heading: "Photosynthesis",
    });
    expect(chunks[0].text).toContain("chloroplasts");
  });
});
