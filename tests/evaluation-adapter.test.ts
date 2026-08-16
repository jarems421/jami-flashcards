import { describe, expect, it } from "vitest";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper, exemplarsToParts } from "@/lib/evaluation/practice-paper-adapter";
import { stratifiedSlice } from "@/lib/evaluation/sampling";

function record(overrides: Partial<MarkingCorpusRecord> = {}): MarkingCorpusRecord {
  return {
    id: "r1",
    sourceId: "asap-2",
    level: "usStateAssessment",
    subject: "english",
    regime: "banded",
    questionId: "Driverless cars",
    questionPrompt: "Write an argument about driverless cars.",
    answer: { kind: "text", text: "Driverless cars cannot judge." },
    humanMarks: [4],
    maxMarks: 6,
    ...overrides,
  };
}

describe("dressing a record as a practice paper", () => {
  it("makes a one-question paper worth the record's marks", () => {
    const result = adaptRecordToPaper(record());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { paper } = result.adapted;
    expect(paper.questions).toHaveLength(1);
    expect(paper.questions[0].marks).toBe(6);
    expect(paper.totalMarks).toBe(6);
    expect(paper.choiceGroups).toEqual([]);
  });

  /**
   * The marking prompt branches on words in the assessment profile —
   * quantitative subjects get method-mark guidance, essays get knowledge and
   * evaluation guidance. A vague profile would silently evaluate the fallback
   * branch instead of the one a real student's paper reaches.
   */
  it("names the subject so the marking prompt takes the right branch", () => {
    const essay = adaptRecordToPaper(record());
    const maths = adaptRecordToPaper(record({ subject: "maths", level: "gcse" }));
    expect(essay.ok && essay.adapted.paper.assessmentProfile.specificationOrCourse).toContain("essay");
    expect(maths.ok && maths.adapted.paper.assessmentProfile.formatSummary).toContain("mathematics");
  });

  it("keeps the qualification and its detail on the paper", () => {
    const result = adaptRecordToPaper(record({ levelDetail: "Grade 9" }));
    expect(result.ok && result.adapted.paper.assessmentProfile.studyLevel).toBe(
      "US state assessment (Grade 9)"
    );
  });

  it("carries the published scheme rather than inventing one", () => {
    const withScheme = adaptRecordToPaper(record({ markScheme: "SCORE OF 6: mastery." }));
    expect(withScheme.ok && withScheme.adapted.paper.markScheme.kind).toBe("official");

    const without = adaptRecordToPaper(record({ markScheme: undefined }));
    expect(without.ok && without.adapted.paper.markScheme.kind).toBe("missing");
    expect(without.ok && without.adapted.paper.markScheme.notice).toContain("published no scheme");
  });

  it("turns criteria into mark points for a criterion-marked record", () => {
    const result = adaptRecordToPaper(
      record({
        regime: "additive",
        subject: "maths",
        maxMarks: 2,
        criteria: [
          { id: "Mark 1", available: 1, awarded: 1, description: "find midpoint of PQ" },
          { id: "Mark 2", available: 1, awarded: 0, followThrough: true },
        ],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.adapted.paper.markScheme.items[0];
    expect(item.marking).toBe("additive");
    if (item.marking !== "additive") return;
    expect(item.points.map((point) => point.text)).toEqual(["find midpoint of PQ", "Mark 2"]);
    expect(item.points[1].ft).toBe(true);
  });

  it("marks a banded record as one band across the scale", () => {
    const result = adaptRecordToPaper(record({ markScheme: "Band descriptors." }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.adapted.paper.markScheme.items[0];
    expect(item.marking).toBe("banded");
    if (item.marking !== "banded") return;
    expect(item.bands[0]).toMatchObject({ minMarks: 0, maxMarks: 6 });
  });

  /** A scan would have to be loaded and encoded; refused, not marked blind. */
  it("refuses a scanned answer instead of sending nothing", () => {
    const result = adaptRecordToPaper(
      record({ answer: { kind: "image", paths: ["/script.pdf#page=3"] } })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("scanned image");
  });

  it("refuses an empty answer", () => {
    const result = adaptRecordToPaper(record({ answer: { kind: "text", text: "   " } }));
    expect(result.ok).toBe(false);
  });
});

describe("exemplars as prompt parts", () => {
  it("includes the mark a human actually gave", () => {
    const parts = exemplarsToParts([record({ id: "e1", humanMarks: [5] })]);
    expect(parts).toHaveLength(1);
    expect("text" in parts[0] && parts[0].text).toContain("awarded: 5 out of 6");
  });

  it("includes both marks where two humans marked it", () => {
    const parts = exemplarsToParts([record({ humanMarks: [4, 6] })]);
    expect("text" in parts[0] && parts[0].text).toContain("4 and 6");
  });

  it("includes the marker's reasoning where the source published it", () => {
    const parts = exemplarsToParts([record({ examinerCommentary: "Mark 2 not awarded — no evidence." })]);
    expect("text" in parts[0] && parts[0].text).toContain("Mark 2 not awarded");
  });

  it("skips a scanned exemplar rather than describing one it cannot show", () => {
    expect(exemplarsToParts([record({ answer: { kind: "image", paths: ["/a.pdf"] } })])).toEqual([]);
  });
});

describe("choosing the slice", () => {
  const many = Array.from({ length: 400 }, (_unused, index) =>
    record({
      id: `r${index}`,
      questionId: `q${index % 20}`,
      sourceId: index % 3 === 0 ? "mohler" : "asap-2",
      humanMarks: [index % 7 === 0 ? 1 : index % 5 === 0 ? 6 : 4],
    })
  );

  it("returns exactly the size asked for", () => {
    expect(stratifiedSlice({ records: many, size: 40 })).toHaveLength(40);
  });

  it("gives the same slice every run", () => {
    const first = stratifiedSlice({ records: many, size: 30 }).map((r) => r.id);
    const second = stratifiedSlice({ records: many, size: 30 }).map((r) => r.id);
    expect(first).toEqual(second);
  });

  /**
   * A slice taken in corpus order lands in one source and one part of the mark
   * scale. Marking failures are not spread evenly up the scale, so a sample
   * from the middle hides a marker that collapses at the extremes.
   */
  it("spreads across sources and attainment rather than taking the head", () => {
    const slice = stratifiedSlice({ records: many, size: 40 });
    expect(new Set(slice.map((r) => r.sourceId)).size).toBeGreaterThan(1);
    const marks = new Set(slice.map((r) => r.humanMarks[0]));
    expect(marks.size).toBeGreaterThan(1);
    expect(marks.has(1)).toBe(true);
    expect(marks.has(6)).toBe(true);
  });

  it("takes everything when asked for more than exists", () => {
    expect(stratifiedSlice({ records: many.slice(0, 5), size: 50 })).toHaveLength(5);
  });
});
