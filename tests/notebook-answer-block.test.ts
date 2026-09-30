import { describe, expect, it } from "vitest";
import {
  createNotebookAnswerBlock,
  estimateNotebookAnswerHeight,
} from "@/lib/workspace/notebook-answer-block";
import {
  MAX_NOTEBOOK_MARKDOWN_BLOCK_TEXT,
  MAX_NOTEBOOK_TEXT_BLOCK_TEXT,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  getNotebookTextBlockTextLimit,
  normalizeNotebookTextBlocks,
} from "@/lib/workspace/notebooks";
import {
  getNotebookTextBlockMetrics,
  getNotebookTextBlockStyle,
  NOTEBOOK_TEXT_STYLE,
} from "@/lib/workspace/notebook-text-metrics";

const ANSWER = [
  "The **area** of a circle is $\\pi r^2$.",
  "",
  "| Radius | Area |",
  "| --- | --- |",
  "| 1 | $\\pi$ |",
  "| 2 | $4\\pi$ |",
].join("\n");

function place(page: Parameters<typeof createNotebookAnswerBlock>[0]["page"], text = ANSWER) {
  const result = createNotebookAnswerBlock({ id: "answer-1", text, page });
  if (!result.ok) throw new Error(result.message);
  return result.block;
}

describe("a Tutor answer on a notebook page", () => {
  it("keeps the answer's own Markdown, to be shown the way the Tutor showed it", () => {
    const block = place({ textBlocks: [] });
    expect(block.text).toBe(ANSWER);
    expect(block.format).toBe("markdown");
    expect(block.x + block.width).toBeLessThanOrEqual(NOTEBOOK_PAGE_COORDINATE_WIDTH);
  });

  it("goes at the top of an empty page", () => {
    expect(place({ textBlocks: [] }).y).toBe(60);
  });

  it("goes under what is already on the page", () => {
    const block = place({
      textBlocks: [{ y: 80, height: 100 }],
      imageRefs: [{ y: 200, displayHeight: 150 }],
      graphBlocks: [{ y: 120, height: 90 }],
    });
    expect(block.y).toBe(374);
  });

  it("goes to the top when there is no room left below", () => {
    const block = place({ textBlocks: [{ y: 900, height: 300 }] });
    expect(block.y).toBe(60);
  });

  it("starts short, to grow to the answer's real height once shown", () => {
    const block = place({ textBlocks: [] });
    expect(block.height).toBeLessThan(estimateNotebookAnswerHeight(ANSWER));
  });

  it("refuses an empty answer and one too long for a page", () => {
    expect(createNotebookAnswerBlock({ id: "a", text: "  ", page: { textBlocks: [] } }).ok).toBe(false);
    const long = "x".repeat(MAX_NOTEBOOK_MARKDOWN_BLOCK_TEXT + 1);
    const result = createNotebookAnswerBlock({ id: "a", text: long, page: { textBlocks: [] } });
    expect(result.ok).toBe(false);
  });

  it("estimates a table and a paragraph as taller than the paragraph alone", () => {
    const paragraph = "A sentence about circles.";
    expect(estimateNotebookAnswerHeight(ANSWER)).toBeGreaterThan(
      estimateNotebookAnswerHeight(paragraph)
    );
    expect(estimateNotebookAnswerHeight(ANSWER)).toBeLessThan(NOTEBOOK_PAGE_COORDINATE_HEIGHT);
  });
});

describe("the format a text box is saved with", () => {
  const stored = {
    id: "b1",
    x: 60,
    y: 60,
    width: 780,
    height: 96,
    text: ANSWER,
    outlineVisible: false,
  };

  it("survives a save and load", () => {
    const [block] = normalizeNotebookTextBlocks([{ ...stored, format: "markdown" }]);
    expect(block.format).toBe("markdown");
  });

  it("is absent on a typed box, never an undefined field Firestore would refuse", () => {
    const [typed] = normalizeNotebookTextBlocks([stored]);
    expect("format" in typed).toBe(false);
    const [unknown] = normalizeNotebookTextBlocks([{ ...stored, format: "html" }]);
    expect("format" in unknown).toBe(false);
  });

  it("gives an answer more room than a typed box", () => {
    expect(getNotebookTextBlockTextLimit({ format: "markdown" })).toBe(MAX_NOTEBOOK_MARKDOWN_BLOCK_TEXT);
    expect(getNotebookTextBlockTextLimit({})).toBe(MAX_NOTEBOOK_TEXT_BLOCK_TEXT);
  });

  it("sets an answer a size down from typed notes, and typed notes as they were", () => {
    expect(getNotebookTextBlockStyle({})).toBe(NOTEBOOK_TEXT_STYLE);
    expect(getNotebookTextBlockMetrics({ format: "markdown" }).fontSize).toBeLessThan(
      getNotebookTextBlockMetrics({}).fontSize
    );
  });
});
