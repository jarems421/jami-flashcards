import { describe, expect, it } from "vitest";
import {
  boardHasSourcePattern,
  distinctQuestionPaperUrls,
  examSourceCandidates,
  markSchemeUrlsFor,
} from "@/lib/practice/exam-source-patterns";
import { isOfficialExamBoardUrl } from "@/lib/practice/exam-formats";

/**
 * Every URL these produce must be one the board actually serves, and one the
 * allowlist will let ingestion fetch. The AQA shapes below were confirmed
 * against the live filestore before being written down.
 */
describe("AQA", () => {
  const [candidate] = examSourceCandidates({
    board: "aqa",
    specificationId: "8300",
    componentCode: "1H",
    year: 2023,
    series: "June",
  });

  it("addresses a paper exactly, with no guessing", () => {
    expect(candidate.questionPaperUrl).toBe(
      "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2023/june/AQA-83001H-QP-JUN23.PDF"
    );
    expect(candidate.markSchemeUrl).toBe(
      "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2023/june/AQA-83001H-MS-JUN23.PDF"
    );
  });

  it("produces one candidate, because there is nothing to search", () => {
    expect(examSourceCandidates({
      board: "aqa", specificationId: "8461", componentCode: "1F", year: 2024, series: "November",
    })).toHaveLength(1);
  });

  it("uses the series directory and suffix the board uses", () => {
    const [november] = examSourceCandidates({
      board: "aqa", specificationId: "8300", componentCode: "2H", year: 2022, series: "November",
    });
    expect(november.questionPaperUrl).toContain("/2022/november/");
    expect(november.questionPaperUrl).toContain("-QP-NOV22.PDF");
  });
});

describe("Pearson Edexcel", () => {
  const candidates = examSourceCandidates({
    board: "pearson_edexcel",
    specificationId: "1MA1",
    componentCode: "1MA1/1H",
    year: 2023,
    series: "June",
  });

  /*
   * A real one, found by hand: the paper is named for the day it was sat and
   * the scheme for the day results came out. Neither is derivable, so the
   * generated set has to contain them.
   */
  it("contains the real June 2023 1MA1/1H pair", () => {
    const papers = distinctQuestionPaperUrls(candidates);
    expect(papers).toContain(
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-que-20230519.pdf"
    );
    const schemes = markSchemeUrlsFor(
      candidates,
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-que-20230519.pdf"
    );
    expect(schemes).toContain(
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-rms-20230824.pdf"
    );
  });

  it("never proposes a weekend sitting", () => {
    for (const url of distinctQuestionPaperUrls(candidates)) {
      const stamp = url.match(/que-(\d{8})\.pdf$/)?.[1] ?? "";
      const date = new Date(
        Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)))
      );
      expect([0, 6]).not.toContain(date.getUTCDay());
    }
  });

  it("keeps the search small enough to be worth running", () => {
    // Each distinct paper is checked once; the schemes are only probed after
    // one is found, so this is the number of requests that actually happen.
    expect(distinctQuestionPaperUrls(candidates).length).toBeLessThan(60);
  });
});

describe("boards with no derivable address", () => {
  /*
   * OCR names every document by an opaque asset id -- 705050-question-paper-
   * paper-1.pdf -- which nothing derives from a specification. Returning
   * nothing is the honest answer; those papers are supplied directly.
   */
  it("says so rather than inventing a URL", () => {
    expect(examSourceCandidates({
      board: "ocr", specificationId: "J560", componentCode: "01", year: 2023, series: "June",
    })).toEqual([]);
    expect(boardHasSourcePattern("ocr")).toBe(false);
    expect(boardHasSourcePattern("aqa")).toBe(true);
  });
});

describe("everything generated stays on the board's own domain", () => {
  it("passes the allowlist ingestion enforces", () => {
    const aqa = examSourceCandidates({
      board: "aqa", specificationId: "8300", componentCode: "1H", year: 2023, series: "June",
    });
    const pearson = examSourceCandidates({
      board: "pearson_edexcel", specificationId: "1MA1", componentCode: "1MA1/1H", year: 2023, series: "June",
    }).slice(0, 5);
    for (const candidate of aqa) {
      expect(isOfficialExamBoardUrl("aqa", candidate.questionPaperUrl)).toBe(true);
      expect(isOfficialExamBoardUrl("aqa", candidate.markSchemeUrl)).toBe(true);
    }
    for (const candidate of pearson) {
      expect(isOfficialExamBoardUrl("pearson_edexcel", candidate.questionPaperUrl)).toBe(true);
      expect(isOfficialExamBoardUrl("pearson_edexcel", candidate.markSchemeUrl)).toBe(true);
    }
  });
});
