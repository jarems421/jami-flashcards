import { describe, expect, it } from "vitest";
import {
  parseSqaAssignment,
  readLegacyModernStudiesSummary,
  readModernStudiesSummary,
  readPsychologySections,
  splitByCandidate,
} from "@/lib/evaluation/sources/sqa-assignment";

const footer = (page: number) =>
  `Modern Studies Higher Assignment 2023 Commentaries SQA | www.understandingstandards.org.uk ${page} of 10`;

const summary = (total: number, marks: [number, number, number, number, number]) =>
  `Overall, the candidate was awarded ${total} out of 30 marks for their assignment: ` +
  `A: Knowledge and understanding: ${marks[0]} marks B: Analysing and synthesising: ${marks[1]} marks ` +
  `C: Source evaluation: ${marks[2]} marks D: Structure: ${marks[3]} marks E: Reaching a decision: ${marks[4]} marks`;

describe("reading a Modern Studies summary", () => {
  it("takes each section and the examiner's own total", () => {
    const award = readModernStudiesSummary(summary(14, [10, 0, 0, 2, 2]));
    expect(award?.total).toBe(14);
    expect(award?.sections).toEqual([
      { name: "Knowledge and understanding", awarded: 10 },
      { name: "Analysing and synthesising", awarded: 0 },
      { name: "Source evaluation", awarded: 0 },
      { name: "Structure", awarded: 2 },
      { name: "Reaching a decision", awarded: 2 },
    ]);
  });

  /**
   * The footer lands wherever it sits on the page, which is in the middle of a
   * summary that crosses a page break. Left alone it swallows the last section:
   * one 2024 candidate appears to list four sections against a stated 24 until
   * the furniture is removed, and then lists five that sum to exactly 24.
   */
  it("survives a footer landing inside the section list", () => {
    const text =
      `Overall, the candidate was awarded 24 out of 30 for their assignment: ` +
      `A: Knowledge and understanding: 5 marks* B: Analysing and synthesising: 10 marks* ` +
      `C: Source evaluation: 2 marks D: Structure: 4 marks ${footer(4)} E: Reaching a decision: 3 marks`;
    const award = readModernStudiesSummary(text);
    expect(award?.total).toBe(24);
    expect(award?.sections).toHaveLength(5);
    expect(award?.sections.reduce((t, s) => t + s.awarded, 0)).toBe(24);
  });

  it("accepts a singular mark and a total with no unit", () => {
    const text =
      `Overall, the candidate was awarded 13 out of 30 for their assignment: ` +
      `A: Knowledge and understanding: 3 marks B: Analysing and synthesising: 5 marks ` +
      `C: Source evaluation: 1 mark D: Structure: 3 marks E: Reaching a decision: 1 mark`;
    expect(readModernStudiesSummary(text)?.sections[2]).toEqual({
      name: "Source evaluation",
      awarded: 1,
    });
  });

  it("returns nothing rather than a guess when there is no summary", () => {
    expect(readModernStudiesSummary("The candidate wrote at length about devolution.")).toBeNull();
  });
});

/**
 * 2015 lists the sections as bare pairs and names two of them differently.
 * They are the same sections and have to compare as one, or records from the
 * two years cannot be scored against each other.
 */
describe("reading the 2015 Modern Studies form", () => {
  const legacy =
    "1 mark (structure). Knowledge 2 Analysis/Synthesis 3 Source Evaluation 0 Structure 1 Decision 1 " +
    "The candidate was awarded 7/30 marks for this Assignment.";

  it("normalises the older section names onto the current ones", () => {
    const award = readLegacyModernStudiesSummary(legacy);
    expect(award?.total).toBe(7);
    expect(award?.sections.map((s) => s.name)).toEqual([
      "Knowledge and understanding",
      "Analysing and synthesising",
      "Source evaluation",
      "Structure",
      "Reaching a decision",
    ]);
  });

  /** The prose above the summary mentions the same labels; the summary wins. */
  it("takes the summary rather than an earlier mention", () => {
    const award = readLegacyModernStudiesSummary(
      "This was awarded 1 mark (decision). Structure 9 " + legacy
    );
    expect(award?.sections.find((s) => s.name === "Structure")?.awarded).toBe(1);
  });
});

describe("reading Psychology sections", () => {
  const psychology =
    "The candidate achieved 32 marks for this course assessment component. " +
    "Section A The candidate was awarded 8 marks because they have provided theoretical background: " +
    "♦ Description of relevant psychology theory/concept. (4 marks) " +
    "Section B The candidate was awarded 2 marks because the aim clearly relates. " +
    "Section C The candidate was awarded 5 marks as they have provided 5 accurate points.";

  it("takes each lettered section and the stated total", () => {
    const award = readPsychologySections(psychology);
    expect(award?.total).toBe(32);
    expect(award?.sections).toEqual([
      { name: "Section A", awarded: 8 },
      { name: "Section B", awarded: 2 },
      { name: "Section C", awarded: 5 },
    ]);
  });

  /** The bulleted items inside a section restate marks; only the section counts. */
  it("does not mistake a bulleted item for another section", () => {
    expect(readPsychologySections(psychology)?.sections).toHaveLength(3);
  });
});

describe("splitting a commentary into candidates", () => {
  it("opens a block at each candidate's first mention", () => {
    const blocks = splitByCandidate([
      { page: 1, text: "Candidate 1 Title: Scotland. Some prose." },
      { page: 2, text: "Candidate 2 Title: Guns. More prose." },
    ]);
    expect(blocks.map((b) => b.candidate)).toEqual([1, 2]);
    expect(blocks[0].text).toContain("Scotland");
    expect(blocks[0].text).not.toContain("Guns");
  });

  /** A commentary refers back to earlier candidates; that must not reopen them. */
  it("ignores a later reference to a candidate already opened", () => {
    const blocks = splitByCandidate([
      { page: 1, text: "Candidate 1 first. Unlike Candidate 1 above, Candidate 2 did better." },
    ]);
    expect(blocks.map((b) => b.candidate)).toEqual([1, 2]);
  });
});

describe("building records", () => {
  const series = (text: string) => ({
    sourceId: "sqa-higher-modern-studies-assignment",
    subject: "modernStudies",
    maxMarks: 30,
    series: [
      {
        id: "2023",
        form: "modernStudies" as const,
        candidates: [{ candidate: 1, text, evidence: "/evidence.pdf#page=2-5" }],
      },
    ],
  });

  it("records one criterion per section, against the scanned assignment", () => {
    const result = parseSqaAssignment(series(summary(14, [10, 0, 0, 2, 2])));
    expect(result.records).toHaveLength(1);
    const record = result.records[0];
    expect(record.id).toBe("sqa-higher-modern-studies-assignment:2023:c1");
    expect(record.humanMarks).toEqual([14]);
    expect(record.maxMarks).toBe(30);
    expect(record.regime).toBe("weightedTraits");
    expect(record.answer).toEqual({ kind: "image", paths: ["/evidence.pdf#page=2-5"] });
    expect(record.criteria?.map((c) => c.description)).toEqual([
      "Knowledge and understanding",
      "Analysing and synthesising",
      "Source evaluation",
      "Structure",
      "Reaching a decision",
    ]);
  });

  /**
   * The examiner's own total is the check. Where the sections fall short of it
   * the summary is incomplete, and recording the shortfall would put the
   * examiner's name to a breakdown they did not give.
   */
  it("skips a candidate whose sections do not reach the stated total", () => {
    const short =
      "Overall, the candidate was awarded 24 out of 30 marks for their assignment: " +
      "A: Knowledge and understanding: 5 marks B: Analysing and synthesising: 10 marks " +
      "C: Source evaluation: 2 marks D: Structure: 4 marks";
    const result = parseSqaAssignment(series(short));
    expect(result.records).toHaveLength(0);
    expect(result.stats.unbalanced).toBe(1);
    expect(result.issues.join(" ")).toContain("sections total 21 against the examiner's 24");
  });

  it("skips a commentary it cannot read rather than inventing marks", () => {
    const result = parseSqaAssignment(series("The candidate wrote about devolution."));
    expect(result.records).toHaveLength(0);
    expect(result.stats.unreadable).toBe(1);
  });

  /**
   * SQA publishes the assignment's total but never its split, so a section's
   * tariff is the most any candidate reached on it -- a floor, not a fact.
   * Leaving it at zero would make every section look impossible to earn.
   */
  it("infers each section's tariff from the best candidate on it", () => {
    const result = parseSqaAssignment({
      sourceId: "sqa-higher-modern-studies-assignment",
      subject: "modernStudies",
      maxMarks: 30,
      series: [
        {
          id: "2023",
          form: "modernStudies",
          candidates: [
            { candidate: 1, text: summary(14, [10, 0, 0, 2, 2]), evidence: "/a.pdf#page=2" },
            { candidate: 2, text: summary(30, [10, 10, 2, 4, 4]), evidence: "/b.pdf#page=2" },
          ],
        },
      ],
    });
    const first = result.records[0].criteria ?? [];
    expect(first.find((c) => c.description === "Analysing and synthesising")?.available).toBe(10);
    expect(first.find((c) => c.description === "Structure")?.available).toBe(4);
    expect(result.stats.criteria).toBe(10);
  });
});
