import { describe, expect, it } from "vitest";
import {
  findQuestionStarts,
  readPrintedTariff,
  readPrintedTariffs,
  regionsForQuestion,
  schemeCoversQuestion,
  type PdfPageText,
} from "@/lib/practice/exam-page-regions";

/** PDF y grows upward from the bottom, which is why `top` is height - y. */
function page(number: number, items: Array<[string, number, number]>): PdfPageText {
  return {
    page: number,
    width: 600,
    height: 800,
    items: items.map(([text, x, y]) => ({ text, x, y, height: 10 })),
  };
}

describe("finding where questions start", () => {
  const pages = [
    page(1, [
      ["1", 50, 750],
      ["Work out 3 + 4.", 120, 750],
      ["2", 50, 500],
      ["Simplify the expression.", 120, 500],
    ]),
    page(2, [
      ["3", 50, 700],
      ["Solve for x.", 120, 700],
    ]),
  ];

  it("reads the numbers printed in the left margin, in order", () => {
    expect(findQuestionStarts(pages)).toEqual([
      { label: "1", page: 1, top: 50 },
      { label: "2", page: 1, top: 300 },
      { label: "3", page: 2, top: 100 },
    ]);
  });

  it("ignores numbers in the body of the page", () => {
    // An answer line or a figure caption is not a question start.
    const withBodyNumbers = [
      page(1, [["1", 50, 750], ["Work out 3 + 4.", 120, 750], ["7", 400, 600], ["12", 300, 400]]),
    ];
    expect(findQuestionStarts(withBodyNumbers).map((s) => s.label)).toEqual(["1"]);
  });

  /*
   * An AQA English Language paper sets its reading sources at x=51, left of
   * the `0 1` it numbers questions with. Reading the margin from where prose
   * starts put the boundary left of every label, and the paper yielded no
   * questions at all.
   */
  it("finds the labels on a paper whose source text is set left of them", () => {
    const source = (y: number, text: string): [string, number, number] => [text, 51, y];
    const pages = [
      page(1, [
        ["0", 52, 700], ["1", 69, 700], ["Read again the first part of Source A.", 93, 700],
        source(660, "The narrator describes the house at length."),
        source(640, "It had stood empty for a decade before then."),
        source(620, "Nobody in the village would go near it."),
        source(600, "The windows were boarded from the inside."),
        ["0", 52, 560], ["2", 69, 560], ["Look in detail at this extract.", 93, 560],
        source(520, "A second source follows on the next page."),
        source(500, "It was written nearly a century later."),
      ]),
    ];
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual(["1", "2"]);
  });

  /*
   * A Literature paper's set text is the busiest column on the page, and the
   * verse's own line numbers sit left of it -- so both "leftmost prose" and
   * "busiest prose" read 5, 10, 15 as questions. A paper counts from 1, which
   * is what tells a question number from a line number.
   */
  it("does not mistake a poem's line numbers for questions", () => {
    const verse = (y: number, text: string): [string, number, number] => [text, 138, y];
    const pages = [
      page(1, [
        ["0", 53, 720], ["1", 72, 720], ["Macbeth", 102, 720],
        ["Read the following extract and answer the question.", 102, 700],
        verse(660, "Seyton! I am sick at heart,"),
        ["5", 117, 640], verse(640, "When I behold this push"),
        verse(620, "Will cheer me ever or disseat me now."),
        ["10", 114, 600], verse(600, "I have lived long enough."),
        verse(580, "My way of life is fallen into the sere."),
        ["15", 114, 560], verse(560, "And that which should accompany old age."),
        ["0", 53, 500], ["2", 72, 500], ["Romeo and Juliet", 102, 500],
        ["Read the following extract and answer the question.", 102, 480],
      ]),
    ];
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual(["1", "2"]);
  });

  /*
   * Edexcel Business numbers the first part beside the question -- `1 (a)` --
   * and then prints `(b)`, `(c)` with no number at all. Those later parts read
   * as nothing, so they fell back to a question number the paper never prints
   * on its own, found no region and no tariff, and 27 questions of a real
   * paper were held back.
   */
  it("attaches a bare part letter to the question numbered above it", () => {
    const pages = [
      page(1, [
        ["1", 71, 750], ["(a)", 89, 750], ["Which one of the following is a fixed cost?", 108, 750],
        ["(b)", 89, 700], ["Explain one benefit of market mapping.", 108, 700],
        ["(c)", 89, 650], ["Analyse one drawback of that approach.", 108, 650],
        ["2", 71, 550], ["(a)", 89, 550], ["State one source of business finance.", 108, 550],
        ["(b)", 89, 500], ["Explain one risk of that source.", 108, 500],
      ]),
    ];
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual([
      "1(a)", "1(b)", "1(c)", "2(a)", "2(b)",
    ]);
  });

  /*
   * Edexcel Business opens question 5 with its number beside a sentence set in
   * the column its parts' letters use, not the one their wording uses. The
   * margin filter swallowed number and sentence together and read no label, so
   * question 5 was never found -- and its parts attached to question 4, which
   * stretched 4(b)'s image across the whole of question 5.
   */
  it("finds a question whose wording starts where its parts' letters sit", () => {
    const pages = [
      page(1, [
        ["1", 71, 750], ["(a)", 89, 750], ["Outline one way financial information helps.", 108, 750],
        ["(b)", 89, 700], ["Analyse the impact of non-financial aims.", 108, 700],
        ["2", 71, 640], ["Table 2 shows forecasts from the business plan.", 89, 640],
        ["(a)", 89, 590], ["Using the information in Table 2, calculate the balance.", 108, 590],
        ["3", 71, 520], ["(a)", 89, 520], ["State one element of the marketing mix.", 108, 520],
      ]),
    ];
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual([
      "1(a)", "1(b)", "2", "2(a)", "3(a)",
    ]);
  });

  /*
   * Restored only where it fills a gap in the count: the number after the
   * question before it, and before the question after it. A number that fits
   * nowhere is a table row or a figure caption, and admitting those put a
   * "72" among the questions of a real maths paper.
   */
  it("restores nothing when the count has no gap", () => {
    const pages = [
      page(1, [
        ["1", 71, 750], ["(a)", 89, 750], ["Work out the mean of the readings.", 108, 750],
        ["2", 71, 650], ["(a)", 89, 650], ["Solve the equation.", 108, 650],
        ["40", 71, 600], ["kg of sand was delivered, as Table 1 shows.", 89, 600],
      ]),
    ];
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual(["1(a)", "2(a)"]);
  });

  it("ignores part labels, which belong to the question above them", () => {
    const withParts = [
      page(1, [
        ["1", 50, 750], ["Work out 3 + 4.", 120, 750],
        ["(a)", 60, 700], ["Simplify the thing.", 120, 700],
        ["(b)", 60, 600], ["Factorise the thing.", 120, 600],
      ]),
    ];
    expect(findQuestionStarts(withParts).map((s) => s.label)).toEqual(["1"]);
  });

  /*
   * The shape of Pearson's 1MA1/2H and 3H, June 2023: numbers at x=71, prose at
   * x=89, dotted answer lines back at x=71, and "DO NOT WRITE IN THIS AREA"
   * down the left edge at x=50 on every page. Counted by volume, that edge was
   * the leftmost busy column, and no question on either paper was found.
   */
  /*
   * Pearson 1MA1/3H June 2023, question 16: its number at the top of the page,
   * a diagram, and its first line of wording far below. The page number sits
   * lower and to the right of the question-number column.
   */
  it("keeps a question that opens on a figure, and still refuses page numbers", () => {
    const pages = [
      page(1, [
        ["1", 71, 750], ["Work out the first thing.", 89, 750],
        ["Then write something else down.", 89, 700],
      ]),
      page(2, [
        ["2", 71, 780],
        ["Here is a diagram of a triangle.", 89, 500],
        ["2", 80, 40],
      ]),
      page(3, [
        ["3", 71, 750], ["Solve the third question now.", 89, 750],
        // In the column but with no question 5 after it: not a question.
        ["4", 71, 100],
      ]),
    ];
    expect(findQuestionStarts(pages)).toEqual([
      { label: "1", page: 1, top: 50 },
      { label: "2", page: 2, top: 20 },
      { label: "3", page: 3, top: 50 },
    ]);
  });

  it("is not led off the page by furniture repeated down the left edge", () => {
    const pearson = Array.from({ length: 6 }, (_unused, index) =>
      page(index + 1, [
        ["DO NOT WRITE IN THIS AREA", 50, 623],
        ["DO NOT WRITE IN THIS AREA", 50, 374],
        [String(index + 1), 71, 700],
        [`Question ${index + 1} asks something different.`, 89, 700],
        [`And explains it in another line, ${index + 1}.`, 89, 650],
        ["........................................", 71, 300],
      ])
    );
    expect(findQuestionStarts(pearson).map((start) => start.label)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});

describe("the slice of paper a question occupies", () => {
  const pages = [
    page(1, [["1", 50, 750], ["Work it out.", 120, 750], ["2", 50, 400], ["Simplify the thing.", 120, 400]]),
    page(2, [["3", 50, 600], ["Solve for x now.", 120, 600]]),
  ];
  const starts = findQuestionStarts(pages);

  it("runs from its own label to the next question on the same page", () => {
    const [region] = regionsForQuestion({ label: "1", starts, pages, headroom: 0 });
    expect(region).toEqual({ page: 1, fromRatio: 50 / 800, toRatio: 400 / 800 });
  });

  /*
   * This is the case the whole-page render silently dropped: a question whose
   * continuation is on the following page kept only its first half.
   */
  it("carries on to the next page when the question does", () => {
    const regions = regionsForQuestion({ label: "2", starts, pages, headroom: 0 });
    expect(regions).toEqual([
      { page: 1, fromRatio: 400 / 800, toRatio: 1 },
      { page: 2, fromRatio: 0, toRatio: 200 / 800 },
    ]);
  });

  it("runs to the foot of the page when nothing follows", () => {
    expect(regionsForQuestion({ label: "3", starts, pages, headroom: 0 })).toEqual([
      { page: 2, fromRatio: 200 / 800, toRatio: 1 },
    ]);
  });

  it("returns nothing for a label the paper does not have", () => {
    expect(regionsForQuestion({ label: "9", starts, pages })).toEqual([]);
  });
});

describe("reading the printed tariff", () => {
  // Verbatim from Edexcel 1MA1/1H, June 2023, as pdfjs reads it.
  const edexcel =
    "1 Work out 8.46 ÷ 0.15 ...... (Total for Question 1 is 3 marks) " +
    "2 Work out 7 3 8 2 1 2 − Give your answer as a mixed number. ...... (Total for Question 2 is 3 marks) " +
    "3 Solve ...... (Total for Question 3 is 4 marks)";

  it("reads a Pearson total written with an equals sign", () => {
    // Business writes "= 12 marks" where maths writes "is 12 marks".
    expect([...readPrintedTariffs("(Total for Question 3 = 12 marks)")]).toEqual([["3", 12]]);
  });

  it("maps each question to the tariff the paper prints for it", () => {
    const tariffs = readPrintedTariffs(edexcel);
    expect(tariffs.get("1")).toBe(3);
    expect(tariffs.get("2")).toBe(3);
    expect(tariffs.get("3")).toBe(4);
  });

  /*
   * "(Total for Question 12 is 3 marks)" holds two numbers, and the question
   * number is the larger one. Scanning a region for the biggest number in a
   * bracket would have read the tariff as twelve.
   */
  it("does not mistake the question number for the tariff", () => {
    expect(readPrintedTariffs("(Total for Question 12 is 3 marks)").get("12")).toBe(3);
  });

  it("says nothing about a paper whose format it cannot read", () => {
    expect(readPrintedTariffs("Work out the answer.").size).toBe(0);
  });

  it("falls back to a bare bracketed tariff inside one question's region", () => {
    expect(readPrintedTariff("Work out the answer. (3)")).toBe(3);
    expect(readPrintedTariff("Explain your reasoning. [4 marks]")).toBe(4);
    expect(readPrintedTariff("Work out the answer.")).toBeNull();
  });
});

describe("whether the scheme covers a question", () => {
  // The real shape: boilerplate, then a table whose rows start with the number.
  const scheme =
    "Mark Scheme (Results) Summer 2023 Pearson Edexcel GCSE In Mathematics (1MA1) " +
    "Edexcel and BTEC qualifications are awarded by Pearson ... " +
    "Question Answer Mark Mark scheme Additional guidance " +
    "1 56.4 M1 for a start to a method, eg 846 ÷ 15 " +
    "2 4 7 8 M2 for a complete method";

  it("finds a question that has a row in the table", () => {
    expect(schemeCoversQuestion(scheme, "1")).toBe(true);
    expect(schemeCoversQuestion(scheme, "2")).toBe(true);
  });

  it("refuses a question the table does not carry", () => {
    expect(schemeCoversQuestion(scheme, "9")).toBe(false);
    expect(schemeCoversQuestion(scheme, "")).toBe(false);
  });

  /*
   * "56.4" and "846" are an answer and a working step. Searching the whole
   * document for the digits would have matched them and called every question
   * covered.
   */
  it("does not count numbers that appear before the table", () => {
    expect(schemeCoversQuestion("Pearson Edexcel 2023 GCSE 1MA1 Higher Paper 1H", "1")).toBe(false);
  });
});

/**
 * AQA maths, which is neither of the two shapes this was built for.
 *
 * Edexcel prints a bare `3`. AQA science prints `01.1` in the margin. AQA
 * maths repeats the question number on every part and puts the letter beside
 * it -- `11` then `(a)` -- so the joined margin line reads `11 (a)`. That
 * matched nothing, and every multi-part question on three real papers was
 * rejected: 42 of 42.
 */
describe("a question numbered like AQA maths", () => {
  const pages = [
    page(1, [
      ["11", 44, 765], ["The Venn diagram represents 100 items.", 100, 765],
      ["11", 44, 540], ["(a)", 62, 540], ["Write down P(A and B)", 99, 540],
      ["[1 mark]", 491, 525],
      ["11", 44, 441], ["(b)", 64, 441], ["Work out P(A')", 99, 441],
      ["[1 mark]", 491, 429],
      ["12", 44, 300], ["(a)", 62, 300], ["A different question entirely.", 99, 300],
    ]),
  ];
  const starts = findQuestionStarts(pages);

  it("reads the number and its letter as one part label", () => {
    expect(starts.map((start) => start.label)).toEqual(["11", "11(a)", "11(b)", "12(a)"]);
  });

  /*
   * Question 12 opens straight onto its first part, so its number never
   * appears alone. Before parts were read at all it therefore had no start of
   * any kind -- which is how questions 1, 12 and 13 of 8300/1H lost their
   * regions as well as their parts.
   */
  it("still finds a question that opens straight onto a part", () => {
    expect(starts.some((start) => start.label === "12(a)")).toBe(true);
  });

  it("crops a part to its own lines, not its whole question", () => {
    const own = regionsForQuestion({ label: "11(a)", starts, pages, headroom: 0 });
    expect(own).toEqual([{ page: 1, fromRatio: (800 - 540) / 800, toRatio: (800 - 441) / 800 }]);
  });

  /*
   * "Write down P(A and B)" is unanswerable without the Venn diagram, which is
   * printed once above `(a)` against the bare `11`. A part cropped to its own
   * lines is a question with its subject removed.
   */
  it("carries the question's stem into the part a student sees", () => {
    const withStem = regionsForQuestion({ label: "11(a)", starts, pages, headroom: 0, withStemOf: "11" });
    expect(withStem).toEqual([
      { page: 1, fromRatio: (800 - 765) / 800, toRatio: (800 - 540) / 800 },
      { page: 1, fromRatio: (800 - 540) / 800, toRatio: (800 - 441) / 800 },
    ]);
  });

  it("adds no stem for a question that has none of its own", () => {
    expect(regionsForQuestion({ label: "12(a)", starts, pages, headroom: 0, withStemOf: "12" }))
      .toEqual(regionsForQuestion({ label: "12(a)", starts, pages, headroom: 0 }));
  });

  /*
   * A label's glyphs sit above its baseline, so a crop ending exactly on the
   * next label's baseline still shows that label -- every question image
   * carried the first line of the one after it.
   */
  it("stops short of the next label rather than on it", () => {
    const [region] = regionsForQuestion({ label: "11(a)", starts, pages, headroom: 12 });
    expect(region.toRatio).toBeLessThan((800 - 441) / 800);
  });
});

/**
 * Which column counts as prose, on a paper whose furniture outnumbers it.
 *
 * AQA's 8300/2H prints its footer at x=475 across 32 pages, which outvoted the
 * 39 lines of actual question text at x=99. "Margin" then meant everything
 * left of 473, so a whole line joined into "5 Jess saves 2p, 5p and 10p
 * coins." and normalised to nothing: four question starts were found on a
 * paper with twenty-five.
 */
describe("telling prose from page furniture", () => {
  /*
   * The column the paper numbers in decides the boundary, and the leftmost
   * busy column of prose is the fallback when nothing counts. Whichever
   * decides it, furniture must never become the margin's edge.
   */
  it("never takes page furniture for the body column", () => {
    const body = (n: number) => page(n, [
      [`${n}`, 50, 750],
      // Each page asks its own question, as a real paper does: prose that
      // repeated word for word would be indistinguishable from furniture.
      [`Question ${n} is printed in the body column.`, 99, 750],
      ["IB/M/Jun23/8300/2H", 475, 18],
      ["Do not write outside", 543, 783],
    ]);
    // Five pages: the footer and header repeat on each and the prose does not
    // repeat any harder, so the busiest column is furniture.
    const pages = [1, 2, 3, 4, 5].map(body);
    expect(findQuestionStarts(pages).map((start) => start.label)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
