import { describe, expect, it } from "vitest";
import {
  buildExamPaperManifest,
  examStudyLevelForQualification,
  readExamPaperReference,
  readExamPaperSeries,
  readExamPaperYear,
  type ExamCatalogueCourse,
} from "@/lib/practice/exam-ingestion-manifest";

const NOW = Date.UTC(2026, 8, 9);

const course: ExamCatalogueCourse = {
  board: "aqa",
  boardLabel: "AQA",
  qualification: "gcse",
  subject: "Biology",
  specificationCode: "8461",
  specificationTitle: "GCSE Biology",
  componentCode: "1H",
  componentTitle: "Paper 1 Higher",
};

const candidate = {
  questionPaperUrl: "https://www.aqa.org.uk/8461-1H-QP-JUN23.PDF",
  markSchemeUrl: "https://www.aqa.org.uk/8461-1H-MS-JUN23.PDF",
  label: "GCSE Biology 8461/1H Question paper June 2023",
};

describe("reading a paper's identity from a link", () => {
  it("takes the sitting year and refuses anything implausible", () => {
    expect(readExamPaperYear("Question paper June 2023", NOW)).toBe(2023);
    expect(readExamPaperYear("Specification 8461", NOW)).toBeNull();
    expect(readExamPaperYear("Paper from 1953", NOW)).toBeNull();
  });

  /*
   * Board links routinely carry two years -- the sitting and something from a
   * specification title or a file path -- so the later plausible one wins.
   */
  it("prefers the later year when a link names more than one", () => {
    expect(readExamPaperYear("2019 specification · June 2024 paper", NOW)).toBe(2024);
  });

  it("does not accept a year that has not happened yet", () => {
    expect(readExamPaperYear("June 2030 paper", NOW)).toBeNull();
    expect(readExamPaperYear("June 2027 paper", NOW)).toBe(2027);
  });

  it("normalises the series names boards actually print", () => {
    expect(readExamPaperSeries("Summer 2023")).toBe("June");
    expect(readExamPaperSeries("Autumn series")).toBe("November");
    expect(readExamPaperSeries("Paper 1")).toBeNull();
  });

  it("reads a printed paper reference, or falls back to the course's own codes", () => {
    expect(readExamPaperReference("Biology 8461/1H June 2023", course)).toBe("8461/1H");
    expect(readExamPaperReference("Question paper June 2023", course)).toBe("8461/1H");
  });

  it("maps every servable qualification to a school study level", () => {
    expect(examStudyLevelForQualification("gcse")).toBe("gcse-equivalent");
    expect(examStudyLevelForQualification("national_5")).toBe("gcse-equivalent");
    expect(examStudyLevelForQualification("a_level")).toBe("post-16-equivalent");
    expect(examStudyLevelForQualification("advanced_higher")).toBe("post-16-equivalent");
  });
});

describe("building a manifest", () => {
  it("carries the course through and dates the paper from its link", () => {
    const manifest = buildExamPaperManifest({
      candidate,
      course,
      rightsKey: "aqa-2026",
      rightsVersion: 1,
      now: NOW,
    });
    expect(manifest).toMatchObject({
      board: "aqa",
      qualification: "gcse",
      specificationId: "8461",
      componentCode: "1H",
      studyLevel: "gcse-equivalent",
      year: 2023,
      series: "June",
      paperReference: "8461/1H",
      rightsKey: "aqa-2026",
      rightsVersion: 1,
    });
  });

  /*
   * The identity in a manifest is compared against what the paper itself says,
   * so a made-up sitting would mean checking the paper against fiction. A pair
   * that does not say which sitting it is gets dropped instead.
   */
  it("refuses to invent a sitting the link never named", () => {
    expect(
      buildExamPaperManifest({
        candidate: { ...candidate, label: "Question paper" },
        course,
        rightsKey: "aqa-2026",
        rightsVersion: 1,
        now: NOW,
      })
    ).toBeNull();
    expect(
      buildExamPaperManifest({
        candidate: { ...candidate, label: "Question paper 2023" },
        course,
        rightsKey: "aqa-2026",
        rightsVersion: 1,
        now: NOW,
      })
    ).toBeNull();
  });
});
