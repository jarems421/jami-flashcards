import { describe, expect, it } from "vitest";
import {
  buildPaperCorpusCalibration,
  MIN_CALIBRATION_QUESTIONS,
  normalizePracticePaperCorpusCalibration,
  openingCommandWords,
  plainCourseTitle,
  type CalibrationQuestion,
} from "@/lib/practice/paper-corpus-calibration";

const question = (index: number, overrides: Partial<CalibrationQuestion> = {}): CalibrationQuestion => ({
  paperId: index % 2 === 0 ? "paper-a" : "paper-b",
  componentCode: index % 2 === 0 ? "1MA1/1H" : "1MA1/2H",
  questionNumber: index % 3 === 0 ? `${index}(a)` : `${index}`,
  prompt: index % 4 === 0 ? "Work out the value of x." : "Explain why the angle is 40°.",
  marks: (index % 4) + 1,
  topicIds: [],
  difficulty: index % 5 === 0 ? "hard" : "medium",
  ...overrides,
});

const corpus = (count: number) => Array.from({ length: count }, (_, index) => question(index));

describe("openingCommandWords", () => {
  it("finds command words that open a sentence, not ones buried inside one", () => {
    expect(openingCommandWords("A bag holds 5 counters. Work out the probability.")).toEqual(["Work out"]);
    expect(openingCommandWords("The students work out their results at home.")).toEqual([]);
    expect(openingCommandWords("Calculate the speed.\nGive a reason for your answer.")).toEqual(["Calculate", "Give"]);
  });

  it("does not count an instruction about the answer as the question's command word", () => {
    expect(openingCommandWords("Work out the area.\nGive your answer to 3 significant figures.")).toEqual(["Work out"]);
  });
});

describe("plainCourseTitle", () => {
  it("drops the board and code a catalogue title repeats", () => {
    expect(plainCourseTitle("Pearson Edexcel Level 1/Level 2 GCSE in Mathematics (1MA1)", "Pearson Edexcel", "1MA1")).toBe(
      "Level 1/Level 2 GCSE in Mathematics"
    );
    expect(plainCourseTitle("GCSE Mathematics", "AQA", "8300")).toBe("GCSE Mathematics");
  });
});

describe("buildPaperCorpusCalibration", () => {
  const course = { board: "pearson_edexcel", specificationId: "1MA1", specificationTitle: "GCSE Mathematics" };

  it("says nothing from too few reviewed questions", () => {
    expect(buildPaperCorpusCalibration({ ...course, questions: corpus(MIN_CALIBRATION_QUESTIONS - 1) })).toBeNull();
  });

  it("summarises the papers without passing on any question's wording", () => {
    const questions = corpus(40).map((item, index) =>
      index === 7 ? { ...item, prompt: "Explain why Sam's triangle with sides 7cm, 24cm and 25cm is right-angled." } : item
    );
    const calibration = buildPaperCorpusCalibration({ ...course, questions });
    expect(calibration?.record).toMatchObject({ papers: 2, questions: 40, components: ["1MA1/1H", "1MA1/2H"], specificationId: "1MA1" });
    expect(calibration?.record.boardLabel).toMatch(/Edexcel/);
    const context = calibration?.context ?? "";
    expect(context).toContain("2 reviewed");
    expect(context).toMatch(/Marks per question or part: 1 mark \d+%/);
    expect(context).toMatch(/Command words opening questions.*Explain \d+%.*Work out \d+%/);
    expect(context).toContain("never reuse, adapt or paraphrase");
    expect(context).not.toContain("Sam's triangle");
  });

  it("ignores items with no marks or no prompt", () => {
    const questions = [...corpus(MIN_CALIBRATION_QUESTIONS), question(99, { marks: 0 }), question(98, { prompt: " " })];
    expect(buildPaperCorpusCalibration({ ...course, questions })?.record.questions).toBe(MIN_CALIBRATION_QUESTIONS);
  });
});

describe("normalizePracticePaperCorpusCalibration", () => {
  it("keeps a stored record and drops anything malformed", () => {
    const record = {
      version: 1,
      board: "aqa",
      boardLabel: "AQA",
      specificationId: "8300",
      specificationTitle: "GCSE Mathematics",
      components: ["1H", 3, ""],
      papers: 3,
      questions: 101,
    };
    expect(normalizePracticePaperCorpusCalibration(record)).toEqual({ ...record, components: ["1H"] });
    expect(normalizePracticePaperCorpusCalibration({ ...record, papers: 0 })).toBeUndefined();
    expect(normalizePracticePaperCorpusCalibration({ ...record, version: 2 })).toBeUndefined();
    expect(normalizePracticePaperCorpusCalibration(null)).toBeUndefined();
  });
});
