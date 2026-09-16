import { describe, expect, it } from "vitest";
import { EXAM_CORPUS_TARGETS } from "@/lib/practice/exam-corpus-plan";
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
   * A real one, checked against the live site: the paper's date is when the
   * file was published and the scheme's is when results came out. Neither is
   * derivable, so the generated set has to contain them.
   *
   * This used to name `-que-20230519`, which redirects to an HTML page; the PDF
   * is at `-que-20230520`, a Saturday.
   */
  it("contains the real June 2023 1MA1/1H pair", () => {
    const paper =
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-que-20230520.pdf";
    expect(distinctQuestionPaperUrls(candidates)).toContain(paper);
    expect(markSchemeUrlsFor(candidates, paper)).toContain(
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Mathematics/2015/Exam-materials/1ma1-1h-rms-20230824.pdf"
    );
  });

  /** Skipping weekends made every paper Pearson filed on one undiscoverable. */
  it("proposes files dated on a weekend", () => {
    const days = distinctQuestionPaperUrls(candidates).map((url) => {
      const stamp = url.match(/que-(\d{8})\.pdf$/)?.[1] ?? "";
      return new Date(
        Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)))
      ).getUTCDay();
    });
    expect(days).toContain(6);
    expect(days).toContain(0);
  });

  it("keeps the search small enough to be worth running", () => {
    // Each distinct paper is checked once -- one per day of the sitting window --
    // and schemes are only probed after one is found, so this is the number of
    // requests that actually happen.
    expect(distinctQuestionPaperUrls(candidates).length).toBeLessThanOrEqual(61);
  });
});

/*
 * Pearson's directory is the subject plus the year the specification was
 * issued, and neither is derivable from the specification code. Both pairs
 * below were confirmed by fetching the real files from the live site.
 */
describe("Pearson subjects beyond mathematics", () => {
  it("finds the real June 2023 Business paper", () => {
    const candidates = examSourceCandidates({
      board: "pearson_edexcel", specificationId: "1BS0", componentCode: "1BS0/01", year: 2023, series: "June",
    });
    const paper =
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Business/2017/Exam-materials/1bs0-01-que-20230519.pdf";
    expect(distinctQuestionPaperUrls(candidates)).toContain(paper);
    expect(markSchemeUrlsFor(candidates, paper)).toContain(
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/Business/2017/Exam-materials/1bs0-01-rms-20230824.pdf"
    );
  });

  it("finds the real June 2023 French reading paper", () => {
    const candidates = examSourceCandidates({
      board: "pearson_edexcel", specificationId: "1FR0", componentCode: "1FR0/3H", year: 2023, series: "June",
    });
    const paper =
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/French/2016/Exam-materials/1fr0-3h-que-20230524.pdf";
    expect(distinctQuestionPaperUrls(candidates)).toContain(paper);
    expect(markSchemeUrlsFor(candidates, paper)).toContain(
      "https://qualifications.pearson.com/content/dam/pdf/GCSE/French/2016/Exam-materials/1fr0-3h-rms-20230824.pdf"
    );
  });

  /*
   * A specification nobody has recorded a directory for has no derivable
   * address. Saying so is honest and cheap; guessing a folder would probe
   * hundreds of URLs that cannot exist.
   */
  it("offers nothing for a specification it has no directory for", () => {
    expect(examSourceCandidates({
      board: "pearson_edexcel", specificationId: "1HI0", componentCode: "1HI0/01", year: 2023, series: "June",
    })).toEqual([]);
  });

  it("can address every Pearson course in the rollout", () => {
    for (const target of EXAM_CORPUS_TARGETS.filter((entry) => entry.board === "pearson_edexcel")) {
      const candidates = examSourceCandidates({
        board: "pearson_edexcel",
        specificationId: target.specificationId,
        componentCode: target.components[0]!.code,
        year: 2023,
        series: "June",
      });
      expect(candidates.length).toBeGreaterThan(0);
    }
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
