import { describe, expect, it } from "vitest";
import {
  parseMarkStatement,
  parseQualificationsScotland,
  readCommentaryEntries,
  readCommentaryLines,
  readEvidenceIndex,
} from "@/lib/evaluation/sources/qualifications-scotland";

const footer = (page: number, of: number, kind = "Commentaries") =>
  `Mathematics HigherQuestion Paper 1 2023${kind}SQA | www.understandingstandards.org.uk${page} of ${of}`;

function commentary(...pages: string[]) {
  return pages.map((text, index) => ({ page: index + 1, text }));
}

function evidence(...pages: string[]) {
  return pages.map((text, index) => ({ page: index + 1, text }));
}

describe("reading a commentary", () => {
  /**
   * The regression that matters most in this file. The page footer is
   * extracted glued to the last word of the page, so a pattern that reaches
   * backwards to find the subject eats it — turning "Mark 3 not awarded" into
   * "Mark 3 not", which reads as a mark that was awarded.
   */
  it("strips the footer without taking the verdict glued to it", () => {
    const lines = readCommentaryLines(
      commentary(`Candidate 19\n♦ Mark 1 awarded\n♦ Mark 3 not awarded${footer(3, 6)}`)
    );
    expect(lines).toContain("♦ Mark 3 not awarded");
    expect(lines.join(" ")).not.toContain("understandingstandards");
  });

  it("folds a reason that wraps onto the next line back onto its mark", () => {
    const lines = readCommentaryLines(
      commentary("♦ Mark 2 not awarded – each line of working must be equivalent\nto the line above")
    );
    expect(lines).toEqual([
      "♦ Mark 2 not awarded – each line of working must be equivalent to the line above",
    ]);
  });

  it("carries a statement split across a page break", () => {
    const lines = readCommentaryLines(
      commentary(`♦ Mark 3 not${footer(1, 2)}`, `awarded${footer(2, 2)}`)
    );
    expect(lines).toEqual(["♦ Mark 3 not awarded"]);
  });

  it("groups bullets under the question and candidate above them", () => {
    const entries = readCommentaryEntries(
      commentary("Question 2\nCandidate 2\n♦ Mark 1 awarded\nCandidate 3\n♦ Mark 1 not awarded")
    );
    expect(entries).toEqual([
      { question: 2, candidate: 2, lines: ["♦ Mark 1 awarded"] },
      { question: 2, candidate: 3, lines: ["♦ Mark 1 not awarded"] },
    ]);
  });
});

describe("reading a mark statement", () => {
  it("reads a mark awarded", () => {
    expect(parseMarkStatement("♦ Mark 1 awarded")).toEqual({
      kind: "criteria",
      criteria: [{ id: "Mark 1", available: 1, awarded: 1 }],
    });
  });

  it("reads a mark withheld, with the examiner's reason", () => {
    expect(parseMarkStatement("♦ Mark 2 not awarded – error in gradient formula")).toEqual({
      kind: "criteria",
      criteria: [
        { id: "Mark 2", available: 1, awarded: 0, reason: "error in gradient formula" },
      ],
    });
  });

  it("splits a run of marks sharing one verdict", () => {
    const statement = parseMarkStatement("♦ Marks 3, 4 and 5 awarded");
    expect(statement.kind === "criteria" && statement.criteria.map((c) => c.id)).toEqual([
      "Mark 3",
      "Mark 4",
      "Mark 5",
    ]);
  });

  /** The source writes the singular with a list too. */
  it("reads a list written as 'Mark' rather than 'Marks'", () => {
    const statement = parseMarkStatement("♦ Mark 2 and 3 not awarded");
    expect(statement.kind === "criteria" && statement.criteria.every((c) => c.awarded === 0)).toBe(true);
    expect(statement.kind === "criteria" && statement.criteria).toHaveLength(2);
  });

  it("records follow-through, including the source's own misspelling", () => {
    for (const line of ["♦ Mark 2 awarded on follow-through", "♦ Mark 2 awarded on follow-though"]) {
      const statement = parseMarkStatement(line);
      expect(statement.kind === "criteria" && statement.criteria[0]).toMatchObject({
        awarded: 1,
        followThrough: true,
      });
    }
  });

  /** Some questions are commented on as a fraction, not mark by mark. */
  it("reads a fraction, keeping the marks available", () => {
    expect(parseMarkStatement("♦ 1/2 awarded – this is a graph of f(x)")).toEqual({
      kind: "criteria",
      criteria: [
        { id: "Marks 1-2", available: 2, awarded: 1, reason: "this is a graph of f(x)" },
      ],
    });
  });

  /**
   * A bullet with no verdict is a note about the question, not a judgement on
   * a mark. Counting it either way would invent an examiner decision.
   */
  it("refuses to guess at a bullet that states no verdict", () => {
    expect(parseMarkStatement("♦ Marks 4, 5 and 6 – the same marks are available in both attempts")).toEqual({
      kind: "unreadable",
      text: "Marks 4, 5 and 6 – the same marks are available in both attempts",
    });
  });
});

describe("matching evidence to commentary", () => {
  it("indexes each candidate to the pages their script occupies", () => {
    const index = readEvidenceIndex(
      evidence("Question 1\nCandidate 1", "Candidate 2", "Candidate 3")
    );
    expect(index.get(1)).toEqual({ question: 1, firstPage: 1, lastPage: 1, sharesPage: false });
    expect(index.get(3)).toEqual({ question: 1, firstPage: 3, lastPage: 3, sharesPage: false });
  });

  it("flags a page holding more than one candidate rather than splitting it", () => {
    const index = readEvidenceIndex(evidence("Question 1\nCandidate 1\nCandidate 2", "Candidate 3"));
    expect(index.get(1)).toMatchObject({ firstPage: 1, lastPage: 1, sharesPage: true });
  });
});

describe("qualifications-scotland records", () => {
  const paper = {
    id: "paper-1",
    evidenceFile: "/evidence.pdf",
    commentaryPages: commentary(
      "Question 2\nCandidate 2\n♦ Mark 1 awarded\n♦ Mark 2 not awarded – error in gradient formula\n♦ Marks 3 and 4 awarded on follow-through"
    ),
    evidencePages: evidence("Question 2\nCandidate 2"),
  };
  const input = { seriesId: "higher-maths-2023", subject: "maths", papers: [paper] };

  it("builds one criterion-level record per candidate", () => {
    const { records } = parseQualificationsScotland(input);
    expect(records[0]).toMatchObject({
      id: "qs:higher-maths-2023:paper-1:q2:c2",
      sourceId: "qualifications-scotland",
      regime: "additive",
      questionId: "q2",
      humanMarks: [3],
      maxMarks: 4,
    });
    expect(records[0].criteria).toEqual([
      { id: "Mark 1", available: 1, awarded: 1 },
      { id: "Mark 2", available: 1, awarded: 0, reason: "error in gradient formula" },
      { id: "Mark 3", available: 1, awarded: 1, followThrough: true },
      { id: "Mark 4", available: 1, awarded: 1, followThrough: true },
    ]);
  });

  it("points the answer at the candidate's pages in the evidence PDF", () => {
    const { records } = parseQualificationsScotland(input);
    expect(records[0].answer).toEqual({ kind: "image", paths: ["/evidence.pdf#page=1"] });
  });

  it("writes the mark-by-mark reasoning out as the examiner's commentary", () => {
    const { records } = parseQualificationsScotland(input);
    expect(records[0].examinerCommentary).toContain("Mark 2: not awarded — error in gradient formula");
    expect(records[0].examinerCommentary).toContain("Mark 3: awarded on follow-through");
  });

  /**
   * A commentary that rules on three of five marks says nothing about the
   * other two. Counting them as refused would invent a judgement, so the
   * record is out of what was actually ruled on and the shortfall is reported.
   */
  it("marks a candidate out of what the examiner actually ruled on", () => {
    const partial = {
      ...paper,
      commentaryPages: commentary(
        "Question 4\nCandidate 9\n♦ Mark 1 not awarded\n♦ Mark 2 awarded\nCandidate 10\n♦ Mark 1 awarded\n♦ Marks 2, 3, 4 and 5 awarded"
      ),
      evidencePages: evidence("Question 4\nCandidate 9", "Candidate 10"),
    };
    const result = parseQualificationsScotland({ ...input, papers: [partial] });
    const candidate9 = result.records.find((record) => record.id.endsWith("c9"))!;
    expect(candidate9.maxMarks).toBe(2);
    expect(candidate9.humanMarks).toEqual([1]);
    expect(result.stats.partialCommentary).toBe(1);
    expect(result.issues.join(" ")).toContain("rules on 2 of question 4's 5 marks");
  });

  /**
   * The commentary carries no working and the evidence carries no marks, so a
   * record only means anything if both name the same question. A mark pinned
   * to the wrong script is worse than no record.
   */
  it("drops a candidate the two files disagree about", () => {
    const mismatched = { ...paper, evidencePages: evidence("Question 7\nCandidate 2") };
    const result = parseQualificationsScotland({ ...input, papers: [mismatched] });
    expect(result.records).toHaveLength(0);
    expect(result.stats.questionMismatches).toBe(1);
  });

  it("drops a candidate with no script at all", () => {
    const missing = { ...paper, evidencePages: evidence("Question 2\nCandidate 5") };
    const result = parseQualificationsScotland({ ...input, papers: [missing] });
    expect(result.records).toHaveLength(0);
    expect(result.stats.unmatchedEvidence).toBe(1);
  });

  it("counts the criteria and how many carry a reason", () => {
    const { stats } = parseQualificationsScotland(input);
    expect(stats.criteria).toBe(4);
    expect(stats.criteriaWithReason).toBe(1);
    expect(stats.followThrough).toBe(2);
  });
});
