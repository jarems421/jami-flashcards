import { describe, expect, it } from "vitest";
import { parseAqaAlevelEnglish, readAqaBlocks } from "@/lib/evaluation/sources/aqa-alevel-english";

/** The shape of a saved AQA resource page, furniture and all. */
function page(body: string, { furniture = true } = {}) {
  const chrome = furniture
    ? '<div class="site-nav"><h2>Subjects</h2><p>Site furniture that is not the resource.</p></div>'
    : "";
  return `<html><body>${chrome}<div class="web-resource-content">${body}
    <h2>Specifications that use this resource:</h2><p>English Literature B</p></div></body></html>`;
}

const exemplar = page(`
  <h1>Exemplar student response and examiner commentary</h1>
  <p>An exemplar student response to a Paper 2A question, followed by a commentary.</p>
  <h2>Sample question</h2>
  <p>&#39;In crime writing there are always victims.&#39; Explore the significance.</p>
  <h2>Band 2 response</h2>
  <p>Both texts have victims in them.</p>
  <p>Robbie is the character you feel most sorry for.</p>
  <h2>Examiner commentary</h2>
  <p>This is a fairly basic response and much of it is generalised.</p>
  <h3>AO1</h3><p>The response has a simple structure.</p>
  <h3>AO2</h3><p>There is a little sense of the authors shaping meanings.</p>
  <h3>AO5</h3><p>There is an argument here and a personal view.</p>
  <p>This response seems consistent with the Band 2 descriptors, and is likely to be placed towards the top of the range.</p>
  <p>This resource is part of the Elements of crime writing resource package .</p>
`);

describe("aqa-alevel-english", () => {
  it("keeps only the resource content, not the site furniture", () => {
    const blocks = readAqaBlocks(exemplar);
    expect(blocks.some((block) => block.text.includes("Site furniture"))).toBe(false);
    expect(blocks.some((block) => block.text.includes("Specifications that use"))).toBe(false);
  });

  it("reads the question, the response and the band", () => {
    const { records } = parseAqaAlevelEnglish({ pages: [{ name: "band-2.html", html: exemplar }] });
    expect(records[0].questionPrompt).toContain("always victims");
    expect(records[0].answer).toEqual({
      kind: "text",
      text: "Both texts have victims in them.\n\nRobbie is the character you feel most sorry for.",
    });
    expect(records[0].humanMarks).toEqual([2]);
  });

  /**
   * The band is not a mark out of the paper's total, and recording it as one
   * would misstate the scale. `maxMarks` is the number of bands.
   */
  it("records the band against the number of bands, not the paper total", () => {
    const { records } = parseAqaAlevelEnglish({ pages: [{ name: "band-2.html", html: exemplar }] });
    expect(records[0].maxMarks).toBe(5);
    expect(records[0].regime).toBe("banded");
    expect(records[0].level).toBe("alevel");
  });

  it("labels each objective's commentary with the objective it belongs to", () => {
    const { records, stats } = parseAqaAlevelEnglish({ pages: [{ name: "b.html", html: exemplar }] });
    expect(records[0].examinerCommentary).toContain("AO1: The response has a simple structure.");
    expect(records[0].examinerCommentary).toContain("AO2: There is a little sense");
    expect(stats.withObjectiveCommentary).toBe(3);
  });

  /**
   * The closing verdict judges the whole response but sits after the last
   * objective, so taking the label from its position would file the examiner's
   * overall judgement under AO5.
   */
  it("does not attribute the closing placement to the last objective", () => {
    const { records } = parseAqaAlevelEnglish({ pages: [{ name: "b.html", html: exemplar }] });
    expect(records[0].examinerCommentary).not.toContain("AO5: This response seems consistent");
    expect(records[0].examinerCommentary?.trimEnd()).toMatch(/towards the top of the range\.$/);
  });

  it("drops the page's repeated footer, which is not marking", () => {
    const { records } = parseAqaAlevelEnglish({ pages: [{ name: "b.html", html: exemplar }] });
    expect(records[0].examinerCommentary).not.toContain("resource package");
    expect(records[0].answer.kind === "text" && records[0].answer.text).not.toContain("An exemplar student response");
  });

  it("passes over a page that indexes exemplars but contains none", () => {
    const guide = page("<h1>Teaching guide</h1><h2>Paper 2A, Section A</h2><p>Example answer and commentary - band 3</p>");
    const result = parseAqaAlevelEnglish({ pages: [{ name: "guide.html", html: guide }] });
    expect(result.records).toHaveLength(0);
    expect(result.stats.withoutResponse).toBe(1);
    expect(result.issues).toEqual([]);
  });

  /** One page nests the same sections a level deeper than the others. */
  it("finds the sections whatever heading level they use", () => {
    const nested = page(`
      <h1>Example student response</h1><h2>Paper 1B, Section C</h2>
      <h3>Sample question</h3><p>To what extent do you agree?</p>
      <h3>Band 4 response</h3><p>When considering Emma, it is easy to agree.</p>
      <h3>Examiner commentary</h3><p>A thoughtful response.</p>
    `);
    const { records } = parseAqaAlevelEnglish({ pages: [{ name: "b4.html", html: nested }] });
    expect(records[0].humanMarks).toEqual([4]);
    expect(records[0].questionPrompt).toBe("To what extent do you agree?");
  });

  it("reports a band the examiner's own placement contradicts", () => {
    const contradictory = exemplar.replace("Band 2 response", "Band 4 response");
    const result = parseAqaAlevelEnglish({ pages: [{ name: "b.html", html: contradictory }] });
    expect(result.records[0].humanMarks).toEqual([4]);
    expect(result.issues.join(" ")).toContain("places it in band 2");
  });

  it("counts the band spread, which is what this source is for", () => {
    const { stats } = parseAqaAlevelEnglish({
      pages: [
        { name: "b2.html", html: exemplar },
        { name: "b5.html", html: exemplar.replace(/Band 2/g, "Band 5") },
      ],
    });
    expect(stats.bands).toEqual({ "2": 1, "5": 1 });
  });
});
