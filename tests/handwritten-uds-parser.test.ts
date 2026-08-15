import { describe, expect, it } from "vitest";
import {
  mcqAggregateMismatches,
  packAgreementIssues,
  packScriptLocations,
  parseAnswerKey,
  parseHandwrittenUds,
  parsePackSegments,
  parseQuestionPrompts,
  scriptReference,
} from "@/lib/evaluation/sources/handwritten-uds";

const questionText = `Data Science Examination
Part I: Multiple Choice Questions (1 Mark Each)

1. Which of the following is an assumption of Linear Regression?
A. High multicollinearity
B. Little or no autocorrelation

Part II: Short Answer Questions (2 Marks Each)
21. Define Supervised Learning.
22. Evaluation Case Study: A model achieves 99% accuracy on the training set
but only 30% on the testing set. What is happening?
`;

const answerKeyText = `Question_Number,Type,Correct_Answer
1,MCQ,B
2,MCQ,C
21,Short_Answer,"A type of ML trained on labeled data."
22,Short_Answer,"Overfitting; memorised the training data."
`;

/** Header shape matches the published file, including its 1..35 columns. */
const header = `Student_ID,Student_Name,MCQ mark,2 marks,total,1,2,21,22`;

function csv(...rows: string[]) {
  return [header, ...rows].join("\n");
}

describe("question and key parsing", () => {
  it("reads short-answer prompts across wrapped lines", () => {
    const prompts = parseQuestionPrompts(questionText);
    expect(prompts.get(21)).toBe("Define Supervised Learning.");
    expect(prompts.get(22)).toContain("99% accuracy on the training set but only 30%");
  });

  it("reads only the short-answer references from the key", () => {
    const references = parseAnswerKey(answerKeyText);
    expect(references.get(21)).toBe("A type of ML trained on labeled data.");
    expect(references.has(1)).toBe(false);
  });
});

describe("ingesting marks", () => {
  const base = { questionText, answerKeyText };

  it("makes one record per marked short answer", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0") });
    expect(result.stats.ingested).toBe(2);
    expect(result.records[0]).toMatchObject({
      sourceId: "handwritten-university-data-science",
      level: "undergraduate",
      regime: "pointPool",
      questionId: "q21",
      humanMarks: [2],
      maxMarks: 2,
    });
  });

  it("carries the reference answer as the scheme", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0") });
    expect(result.records[0].markScheme).toBe("A type of ML trained on labeled data.");
  });

  it("keeps half marks rather than rounding them", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,1.5,2.5,B,C,0.5,1.0") });
    expect(result.records[0].humanMarks).toEqual([0.5]);
  });

  /**
   * "Not corrected" is missing data, not a zero. Recording it as zero would
   * invent a human judgement that was never made, and every one of those would
   * then count against the marker under test.
   */
  it("never turns an uncorrected cell into a zero", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,2.0,3.0,B,C,NC,") });
    expect(result.stats.ingested).toBe(0);
    expect(result.stats.uncorrected).toBe(2);
    expect(result.records).toHaveLength(0);
  });

  it("treats the undocumented sentinels the same way", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,2.0,3.0,B,C,NM,-") });
    expect(result.stats.uncorrected).toBe(2);
  });

  it("rejects a mark above the question's maximum", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,4.0,5.0,B,C,4.0,2") });
    expect(result.stats.outOfRange).toBe(1);
    expect(result.stats.ingested).toBe(1);
    expect(result.issues.join(" ")).toContain("outside 0..2");
  });

  /**
   * A shifted row can still have the right number of fields, so length alone
   * does not catch it. A mark that has slid into a multiple-choice column is
   * the tell, and the whole row is then untrustworthy.
   */
  it("skips a row whose columns have shifted, even at the right length", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,2,1.0,2") });
    expect(result.stats.misalignedRows).toBe(1);
    expect(result.stats.ingested).toBe(0);
    expect(result.issues.join(" ")).toContain("shifted");
  });

  it("skips a row of the wrong length outright", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2") });
    expect(result.stats.misalignedRows).toBe(1);
  });

  it("links raw and annotated scripts when they are present", () => {
    const result = parseHandwrittenUds({
      ...base,
      marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0"),
      scripts: { Student_1: { raw: "/Student_Pdf/Student_1.pdf", corrected: "/Corrected_Pdf/Student_1.pdf" } },
    });
    expect(result.records[0].answer).toEqual({
      kind: "image",
      paths: ["/Student_Pdf/Student_1.pdf"],
    });
    expect(result.records[0].examinerCommentary).toContain("Corrected_Pdf");
  });

  it("ingests no multiple-choice questions at all", () => {
    const result = parseHandwrittenUds({ ...base, marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0") });
    expect(result.records.every((record) => Number(record.questionId.slice(1)) >= 21)).toBe(true);
  });
});

/**
 * The packs are a way of moving the files, so the tests hold them to one
 * standard: they must reproduce the published scripts exactly, and their own
 * grouping must never reach the records.
 */
describe("transport packs", () => {
  /** A pack page carrying a text layer is a separator; the scans have none. */
  const pack = [
    { page: 1, text: "Jami University Dataset - Pack 1 Students 1-2" },
    { page: 2, text: "STUDENT 1 - RAW Original unmarked student examination script" },
    { page: 3, text: "" },
    { page: 4, text: "" },
    { page: 5, text: "STUDENT 1 - TEACHER-CORRECTED The corresponding teacher-marked version" },
    { page: 6, text: "" },
    { page: 7, text: "STUDENT 2 - RAW Original unmarked student examination script" },
    { page: 8, text: "" },
  ];

  it("reads each student and version out of the separator pages", () => {
    const { segments } = parsePackSegments(pack);
    expect(segments).toEqual([
      { studentId: "Student_1", role: "raw", firstPage: 3, lastPage: 4 },
      { studentId: "Student_1", role: "corrected", firstPage: 6, lastPage: 6 },
      { studentId: "Student_2", role: "raw", firstPage: 8, lastPage: 8 },
    ]);
  });

  it("does not count the separator page as part of the script", () => {
    const { segments } = parsePackSegments(pack);
    expect(segments[0].firstPage).toBe(3);
  });

  it("reports a separator with no pages behind it", () => {
    const { segments, issues } = parsePackSegments([
      { page: 1, text: "STUDENT 1 - RAW" },
      { page: 2, text: "STUDENT 1 - TEACHER-CORRECTED" },
      { page: 3, text: "" },
    ]);
    expect(issues.join(" ")).toContain("no script pages");
    expect(segments).toHaveLength(1);
  });

  it("says so when the file is not a pack at all", () => {
    expect(parsePackSegments([{ page: 1, text: "" }]).issues.join(" ")).toContain("does not look like");
  });

  it("keeps the page range so a record points at the student's own pages", () => {
    const { scripts } = packScriptLocations([
      { file: "PACK_01.pdf", segments: parsePackSegments(pack).segments },
    ]);
    expect(scripts.Student_1.raw).toEqual({ file: "PACK_01.pdf", firstPage: 3, lastPage: 4 });
    expect(scriptReference(scripts.Student_1.raw!)).toBe("PACK_01.pdf#page=3-4");
    expect(scriptReference(scripts.Student_1.corrected!)).toBe("PACK_01.pdf#page=6");
  });

  it("refuses to let one pack silently overwrite another", () => {
    const segments = parsePackSegments(pack).segments;
    const { issues } = packScriptLocations([
      { file: "PACK_01.pdf", segments },
      { file: "PACK_02.pdf", segments },
    ]);
    expect(issues.join(" ")).toContain("more than one pack");
  });

  /**
   * Transport is only trustworthy if it changed nothing, and a page count that
   * has drifted means the segment ranges point at the wrong pages.
   */
  it("catches a pack whose page count has drifted from the published script", () => {
    const packs = [{ file: "PACK_01.pdf", segments: parsePackSegments(pack).segments }];
    expect(packAgreementIssues({ packs, published: { Student_1: { raw: 2 } } })).toEqual([]);
    expect(
      packAgreementIssues({ packs, published: { Student_1: { raw: 4 } } }).join(" ")
    ).toContain("2 pages against 4");
  });

  it("carries the page range into the record's answer and commentary", () => {
    const result = parseHandwrittenUds({
      questionText,
      answerKeyText,
      marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0"),
      scripts: {
        Student_1: {
          raw: { file: "PACK_01.pdf", firstPage: 3, lastPage: 4 },
          corrected: { file: "PACK_01.pdf", firstPage: 6, lastPage: 7 },
        },
      },
    });
    expect(result.records[0].answer).toEqual({ kind: "image", paths: ["PACK_01.pdf#page=3-4"] });
    expect(result.records[0].examinerCommentary).toContain("PACK_01.pdf#page=6-7");
  });

  /**
   * A record is identified by whose work it is and which question, never by
   * which pack the file happened to travel in.
   */
  it("keeps the pack's grouping out of how a record is identified", () => {
    const result = parseHandwrittenUds({
      questionText,
      answerKeyText,
      marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0"),
      scripts: { Student_1: { raw: { file: "PACK_01_Students_1-5.pdf", firstPage: 3, lastPage: 4 } } },
    });
    expect(result.records[0].id).toBe("handwritten-uds:Student_1:q21");
    expect(Object.keys(result.records[0])).not.toContain("pack");
  });
});

describe("multiple-choice aggregates", () => {
  /**
   * Reported rather than corrected. This is the evidence for not treating the
   * multiple-choice section as ground truth.
   */
  it("reports a stated total that the answers do not support", () => {
    const mismatches = mcqAggregateMismatches({
      answerKeyText,
      // Answers B and C are both correct, so the derived total is 2, not 1.
      marksCsv: csv("Student_1,Anon,1,3.0,4.0,B,C,2,1.0"),
    });
    expect(mismatches).toEqual([{ studentId: "Student_1", stated: 1, derived: 2 }]);
  });

  it("says nothing when the stated total is supported", () => {
    expect(
      mcqAggregateMismatches({
        answerKeyText,
        marksCsv: csv("Student_1,Anon,2,3.0,5.0,B,C,2,1.0"),
      })
    ).toEqual([]);
  });
});
