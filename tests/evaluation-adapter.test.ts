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

  const publishedRubric = [
    "SCORE OF 6: Clear and consistent mastery.",
    "SCORE OF 5: Reasonably consistent mastery.",
    "SCORE OF 4: Adequate mastery.",
    "SCORE OF 3: Developing mastery.",
    "SCORE OF 2: Little mastery.",
    "SCORE OF 1: Very little or no mastery.",
  ].join("\n");

  it("carries the published scheme rather than inventing one", () => {
    const withScheme = adaptRecordToPaper(record({ markScheme: publishedRubric }));
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

  /**
   * The failure this guards against cost a whole evaluation run. A single band
   * spanning the entire scale is not a rubric: there is no gradient, and a
   * marker handed one returned roughly the same mark whatever the tariff,
   * which read as a broken model rather than an empty scheme.
   */
  it("never hands a marker one band across the whole scale", () => {
    for (const scheme of [publishedRubric, "A reference answer with no bands at all."]) {
      const result = adaptRecordToPaper(record({ markScheme: scheme }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const item = result.adapted.paper.markScheme.items[0];
      expect(item.marking).toBe("banded");
      if (item.marking !== "banded") continue;
      expect(item.bands.length).toBeGreaterThan(1);
    }
  });

  it("uses the source's own band descriptors when it published them", () => {
    const result = adaptRecordToPaper(record({ markScheme: publishedRubric }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.adapted.paper.markScheme.items[0];
    if (item.marking !== "banded") throw new Error("expected banded");
    expect(item.bands).toHaveLength(6);
    expect(item.bands.at(-1)).toMatchObject({ minMarks: 6, maxMarks: 6 });
    expect(item.bands.at(-1)?.descriptor).toContain("consistent mastery");
  });

  /**
   * Where only a reference answer was published, the bands are derived from
   * the scale's stated meaning and the scheme says so, rather than presenting
   * invented descriptors as though the source had written them.
   */
  it("marks a derived scale as estimated rather than official", () => {
    const result = adaptRecordToPaper(record({ markScheme: "A reference answer, no bands." }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adapted.paper.markScheme.kind).toBe("estimated");
    expect(result.adapted.paper.markScheme.notice).toContain("no band descriptors");
  });

  /**
   * A scan is markable, but only once somebody has loaded the page. Reading a
   * PDF is I/O and this module is domain logic, so the images arrive from the
   * caller — and a caller who has not loaded them is refused rather than
   * handed a paper with no answer in it.
   */
  it("refuses a scanned answer when no image was supplied", () => {
    const result = adaptRecordToPaper(
      record({ answer: { kind: "image", paths: ["/script.pdf#page=3"] } })
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("no image was supplied");
  });

  it("marks a scanned answer once its pages are supplied", () => {
    const result = adaptRecordToPaper(
      record({ answer: { kind: "image", paths: ["/script.pdf#page=3"] } }),
      { answerImages: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.adapted.answerParts;
    expect(parts).toHaveLength(2);
    expect("text" in parts[0] && parts[0].text).toContain("photographed below");
    expect("inlineData" in parts[1] && parts[1].inlineData.mimeType).toBe("image/png");
  });

  /** Nothing invents a transcription of handwriting nobody has read. */
  it("does not put any answer text on a scanned record", () => {
    const result = adaptRecordToPaper(
      record({ answer: { kind: "image", paths: ["/script.pdf"] } }),
      { answerImages: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] }
    );
    expect(result.ok && JSON.stringify(result.adapted.answerParts)).not.toContain("Driverless");
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
