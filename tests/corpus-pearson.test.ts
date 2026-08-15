import { describe, expect, it } from "vitest";
import { parsePearsonAlevel, readPearsonSections } from "@/lib/evaluation/sources/pearson-alevel";

const footer =
  "Pearson Edexcel International Advanced Subsidiary/Advanced Level in Economics Unit 1 - Exemplar materials\nIssue 1 – February 2020 © Pearson Education Limited 2020";

const pages = (...texts: string[]) => texts.map((text, index) => ({ page: index + 1, text }));

/** A booklet: contents, then a question, then two responses with commentary. */
const booklet = pages(
  "Contents\nQuestion 7 3\nExemplar response A 4\nExemplar response B 5\nQuestion 13 42",
  `${footer}\nQuestion 7\nMark scheme`,
  `${footer}\nExemplar response A\nExaminer’s comments:\nThis response was given 4 marks.\nThey gain the first application mark for drawing the new supply curve.`,
  `${footer}\nExemplar response B\nExaminer’s comments:\nThis response was given 1 mark.\nThe candidate gains the knowledge mark for the original supply and demand.`
);

const unit = { id: "unit-1", file: "/unit1.pdf", pages: booklet };

describe("reading a Pearson booklet", () => {
  /**
   * Every heading appears twice: once in the contents with a page number after
   * it, once as the real heading. Matching the contents form would invent a
   * response for every line of the table.
   */
  it("ignores the contents listing and reads only the real headings", () => {
    const sections = readPearsonSections(booklet);
    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.label)).toEqual(["A", "B"]);
    expect(sections.every((section) => section.question === "7")).toBe(true);
  });

  it("keeps the booklet furniture out of the commentary", () => {
    const sections = readPearsonSections(booklet);
    const commentary = sections[0].commentary.join(" ");
    expect(commentary).not.toContain("Pearson Education Limited");
    expect(commentary).not.toContain("Exemplar materials");
    expect(commentary).not.toContain("Mark scheme");
  });

  it("reads a lettered sub-question as its own question", () => {
    const sections = readPearsonSections(
      pages(`Question 12(c)\nExemplar response A\nExaminer’s comments:\nThis response was given 6 marks.`)
    );
    expect(sections[0].question).toBe("12c");
  });
});

describe("pearson-alevel records", () => {
  it("takes the mark from the examiner's own sentence", () => {
    const { records } = parsePearsonAlevel({ units: [unit] });
    expect(records[0]).toMatchObject({
      id: "pearson:unit-1:q7:A",
      subject: "economics",
      level: "alevel",
      questionId: "q7",
      humanMarks: [4],
    });
    expect(records[1].humanMarks).toEqual([1]);
  });

  it("keeps the examiner's reasoning whole", () => {
    const { records } = parsePearsonAlevel({ units: [unit] });
    expect(records[0].examinerCommentary).toContain("first application mark");
    expect(records[1].examinerCommentary).toContain("knowledge mark");
  });

  it("points the answer at the page the response is reproduced on", () => {
    const { records } = parsePearsonAlevel({ units: [unit] });
    expect(records[0].answer).toEqual({ kind: "image", paths: ["/unit1.pdf#page=3"] });
  });

  /**
   * Nothing in the booklets says what a question was out of — the mark schemes
   * are page images. The best evidenced maximum is the highest mark an exemplar
   * actually received, which is a floor rather than the tariff, so every
   * question says so.
   */
  it("records a maximum it can evidence, and flags that it is a lower bound", () => {
    const result = parsePearsonAlevel({ units: [unit] });
    expect(result.records.every((record) => record.maxMarks === 4)).toBe(true);
    expect(result.stats.tariffFromExemplars).toBe(1);
    expect(result.issues.join(" ")).toContain("nothing states the tariff");
  });

  /**
   * Short questions credit individual knowledge and application marks; the
   * essays are placed against level descriptors per objective strand. The
   * examiner's own language is the evidence for which.
   */
  it("reads the regime from how the examiner wrote about the marks", () => {
    const essay = {
      ...unit,
      pages: pages(
        `Question 13\nExemplar response A\nExaminer’s comments:\nThis response was given 15 marks.\nThe Knowledge, Application and Analysis show a weak Level 3 and scores 9. For Evaluation, it is Level 2.`
      ),
    };
    const result = parsePearsonAlevel({ units: [essay] });
    expect(result.records[0].regime).toBe("weightedTraits");
    expect(parsePearsonAlevel({ units: [unit] }).records[0].regime).toBe("additive");
  });

  it("skips a response whose commentary states no mark", () => {
    const silent = {
      ...unit,
      pages: pages(`Question 7\nExemplar response A\nExaminer’s comments:\nA thoughtful attempt throughout.`),
    };
    const result = parsePearsonAlevel({ units: [silent] });
    expect(result.records).toHaveLength(0);
    expect(result.stats.withoutMark).toBe(1);
    expect(result.issues.join(" ")).toContain("states no mark");
  });

  /** Both units number their questions from 7, so unit and number together identify one. */
  it("does not merge the two units' identically numbered questions", () => {
    const result = parsePearsonAlevel({
      units: [unit, { ...unit, id: "unit-2", file: "/unit2.pdf" }],
    });
    expect(result.stats.questions).toBe(2);
    expect(new Set(result.records.map((record) => record.id)).size).toBe(4);
  });
});
