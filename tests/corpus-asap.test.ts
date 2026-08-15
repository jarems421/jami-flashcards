import { describe, expect, it } from "vitest";
import { DEMOGRAPHIC_COLUMNS, parseAsap2, stageForGrade } from "@/lib/evaluation/sources/asap-2";
import { stageForLevel, stageOf } from "@/lib/evaluation/marking-corpus";

const header =
  "essay_id,score,full_text,set,pubpriv,assignment,prompt_name,economically_disadvantaged," +
  "student_disability_status,ell_status,race_ethnicity,gender,grade_level,essay_word_count,task";

const row = (overrides: Partial<Record<string, string>> = {}) => {
  const fields: Record<string, string> = {
    essay_id: "AAA1",
    score: "4",
    full_text: "Driverless cars are a bad idea because they cannot judge.",
    set: "train",
    pubpriv: "0",
    assignment: "Write an argument about driverless cars.",
    prompt_name: "Driverless cars",
    economically_disadvantaged: "Economically disadvantaged",
    student_disability_status: "Identified as having disability",
    ell_status: "Yes",
    race_ethnicity: "Black/African American",
    gender: "F",
    grade_level: "10",
    essay_word_count: "120",
    task: "Text dependent",
    ...overrides,
  };
  return header
    .split(",")
    .map((column) => `"${(fields[column] ?? "").replace(/"/g, '""')}"`)
    .join(",");
};

const csv = (...rows: string[]) => [header, ...rows].join("\n");

describe("asap-2", () => {
  it("reads the essay, the score and the assignment", () => {
    const { records } = parseAsap2({ essaysCsv: csv(row()) });
    expect(records[0]).toMatchObject({
      id: "asap2:AAA1",
      sourceId: "asap-2",
      subject: "english",
      regime: "banded",
      humanMarks: [4],
      maxMarks: 6,
      questionId: "Driverless cars",
    });
    expect(records[0].questionPrompt).toContain("argument about driverless cars");
  });

  /**
   * The safeguard the taxonomy exists for. A US state assessment sat in Grade
   * 10 is at a similar point in a similar education to GCSE, but it is not one,
   * and filing it as GCSE would let a report claim it had tested GCSE-matched
   * exemplars using American essays.
   */
  it("records the qualification it actually is, never GCSE", () => {
    const { records } = parseAsap2({ essaysCsv: csv(row()) });
    expect(records[0].level).toBe("usStateAssessment");
    expect(records[0].levelDetail).toBe("Grade 10");
  });

  it("records the education stage, which is the comparable part", () => {
    const { records } = parseAsap2({
      essaysCsv: csv(
        row({ essay_id: "young", grade_level: "6" }),
        row({ essay_id: "older", grade_level: "10" })
      ),
    });
    expect(records[0].stage).toBe("lowerSecondary");
    expect(records[1].stage).toBe("upperSecondary");
    expect(stageForGrade(8)).toBe("lowerSecondary");
    expect(stageForGrade(9)).toBe("upperSecondary");
  });

  /**
   * The corpus ships each writer's race, gender, disability status, economic
   * disadvantage and language-learner status. None bears on whether the essay
   * earned its mark, and a record that could carry a child's disability status
   * into a prompt would be indefensible however open the licence.
   */
  it("never ingests a writer's personal characteristics", () => {
    const { records } = parseAsap2({ essaysCsv: csv(row()) });
    const serialised = JSON.stringify(records[0]);
    for (const column of DEMOGRAPHIC_COLUMNS) expect(serialised).not.toContain(column);
    for (const value of ["Black/African American", "Identified as having disability", "Economically disadvantaged"]) {
      expect(serialised).not.toContain(value);
    }
    expect(Object.keys(records[0])).not.toContain("gender");
  });

  it("attaches the rubric as the mark scheme", () => {
    const { records } = parseAsap2({ essaysCsv: csv(row()), rubric: "SCORE OF 6: mastery." });
    expect(records[0].markScheme).toBe("SCORE OF 6: mastery.");
  });

  /**
   * The source text is part of the task — every essay had to read and use it —
   * so it belongs with the prompt, not in `examinerCommentary`, which is for a
   * marker's reasoning. This source has none.
   */
  it("puts the source text with the prompt, not in the commentary", () => {
    const { records } = parseAsap2({
      essaysCsv: csv(row()),
      sourceTexts: { "Driverless cars": "/sources/driverless.pdf" },
    });
    expect(records[0].questionPrompt).toContain("/sources/driverless.pdf");
    expect(records[0].examinerCommentary).toBeUndefined();
  });

  it("skips a score off the one-to-six scale", () => {
    const result = parseAsap2({ essaysCsv: csv(row({ score: "7" })) });
    expect(result.stats.outOfRange).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it("skips an essay with no text", () => {
    const result = parseAsap2({ essaysCsv: csv(row({ full_text: "" })) });
    expect(result.stats.emptyEssay).toBe(1);
  });

  it("counts grades and scores so the spread is visible", () => {
    const result = parseAsap2({
      essaysCsv: csv(row({ essay_id: "a", score: "2", grade_level: "6" }), row({ essay_id: "b", score: "4" })),
    });
    expect(result.stats.byGrade).toEqual({ "6": 1, "10": 1 });
    expect(result.stats.byScore).toEqual({ "2": 1, "4": 1 });
  });
});

describe("education stage", () => {
  it("maps each qualification to where it sits", () => {
    expect(stageForLevel("gcse")).toBe("upperSecondary");
    expect(stageForLevel("alevel")).toBe("upperSecondary");
    expect(stageForLevel("undergraduate")).toBe("undergraduate");
    expect(stageForLevel("postgraduate")).toBe("postgraduate");
  });

  it("prefers a record's own stage where its source spans two", () => {
    expect(stageOf({ level: "usStateAssessment", stage: "lowerSecondary" })).toBe("lowerSecondary");
    expect(stageOf({ level: "usStateAssessment" })).toBe("upperSecondary");
  });
});
