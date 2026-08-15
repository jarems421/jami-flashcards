import { describe, expect, it } from "vitest";
import { parseMedlyGcse } from "@/lib/evaluation/sources/medly-gcse";
import { MODEL_GRADE_COLUMNS, parseJorgpt } from "@/lib/evaluation/sources/jorgpt";
import { DERIVED_COLUMNS, parseAsagGraduate } from "@/lib/evaluation/sources/asag-graduate";
import { humanDisagreement } from "@/lib/evaluation/marking-corpus";

describe("medly-gcse", () => {
  const questions = {
    english_01: {
      question_id: "english_01",
      markmax: 8,
      question_stem: "# The Library\nNia paused beneath the archway.",
      question_text: "How does the writer use language to describe the library?",
      markscheme: "Level 4: perceptive analysis of language.",
    },
    maths_01: { question_id: "maths_01", markmax: 1, question_text: "Write down n(T).", markscheme: "1 mark for 7." },
  };
  const header =
    "answer_id,question_id,subject,modality,answer_file,markmax,examiner_1_mark,examiner_2_mark,examiner_1_ao_marks,examiner_2_ao_marks";
  const csv = (...rows: string[]) => [header, ...rows].join("\n");
  const base = { questions, answerTexts: { eng_0001: "The writer uses a metaphor." } };

  it("keeps both examiners' marks rather than averaging them", () => {
    const result = parseMedlyGcse({
      ...base,
      datasetCsv: csv("eng_0001,english_01,english,typed,answers/english/eng_0001.txt,8,5,7,,"),
    });
    expect(result.records[0].humanMarks).toEqual([5, 7]);
    expect(humanDisagreement(result.records[0])).toBe(2);
    expect(result.stats.examinersDisagreed).toBe(1);
  });

  it("carries the typed answer as text and the handwriting as an image", () => {
    const result = parseMedlyGcse({
      ...base,
      root: "/data",
      datasetCsv: csv(
        "eng_0001,english_01,english,typed,answers/english/eng_0001.txt,8,5,5,,",
        "maths_0001,maths_01,maths,hw,answers/maths/maths_0001.png,1,1,1,,"
      ),
    });
    expect(result.records[0].answer).toEqual({ kind: "text", text: "The writer uses a metaphor." });
    expect(result.records[1].answer).toEqual({
      kind: "image",
      paths: ["/data/answers/maths/maths_0001.png"],
    });
    expect(result.stats).toMatchObject({ typed: 1, handwritten: 1 });
  });

  /** The regime is read off the evidence, not assumed from the subject alone. */
  it("calls a question weighted-trait only when the examiners split it by objective", () => {
    const result = parseMedlyGcse({
      ...base,
      datasetCsv: csv(
        "eng_0001,english_01,english,typed,answers/english/eng_0001.txt,8,5,5,AO5:16;AO6:7,AO5:15;AO6:6",
        "maths_0001,maths_01,maths,hw,answers/maths/maths_0001.png,1,1,1,,"
      ),
    });
    expect(result.records[0].regime).toBe("weightedTraits");
    expect(result.records[0].examinerCommentary).toContain("Examiner 1 assessment objectives: AO5:16, AO6:7");
    expect(result.records[1].regime).toBe("additive");
  });

  it("uses the question file's maximum and says so when the two disagree", () => {
    const result = parseMedlyGcse({
      ...base,
      datasetCsv: csv("eng_0001,english_01,english,typed,answers/english/eng_0001.txt,9,5,5,,"),
    });
    expect(result.records[0].maxMarks).toBe(8);
    expect(result.issues.join(" ")).toContain("out of 9");
  });

  it("skips a mark that cannot fit the question", () => {
    const result = parseMedlyGcse({
      ...base,
      datasetCsv: csv("eng_0001,english_01,english,typed,answers/english/eng_0001.txt,8,5,12,,"),
    });
    expect(result.stats.outOfRange).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it("skips an answer whose question file is missing rather than guessing", () => {
    const result = parseMedlyGcse({
      ...base,
      datasetCsv: csv("eng_0009,english_09,english,typed,answers/english/eng_0009.txt,8,5,5,,"),
    });
    expect(result.stats.missingQuestion).toBe(1);
    expect(result.issues.join(" ")).toContain("no question file");
  });

  it("skips a typed answer whose text could not be read", () => {
    const result = parseMedlyGcse({
      questions,
      datasetCsv: csv("eng_0002,english_01,english,typed,answers/english/eng_0002.txt,8,5,5,,"),
    });
    expect(result.stats.missingAnswer).toBe(1);
    expect(result.records).toHaveLength(0);
  });
});

describe("jorgpt", () => {
  const header =
    "entry_id,question_id,question_text,student_answer,ideal_answer,deepseek_grade,qwen_grade,gemini_grade,judge_grade,teacher_grade,teacher_feedback,teacher_corrected";
  const csv = (...rows: string[]) => [header, ...rows].join("\n");

  it("takes the teacher's grade and the teacher's feedback", () => {
    const result = parseJorgpt({
      datasetCsv: csv("0,Q1,Explain TDD.,Red green refactor.,The TDD cycle...,9,9,9,8.5,6,Missing the refactor step.,True"),
    });
    expect(result.records[0]).toMatchObject({
      humanMarks: [6],
      maxMarks: 10,
      markScheme: "The TDD cycle...",
      examinerCommentary: "Missing the refactor step.",
      subject: "computerScience",
    });
  });

  /**
   * The load-bearing test for this source. Four model grades sit beside the one
   * human grade, and letting any of them into `humanMarks` would mean measuring
   * Jami against another model while calling it human agreement.
   */
  it("never lets a model's grade become a human mark", () => {
    const result = parseJorgpt({
      datasetCsv: csv("0,Q1,Explain TDD.,Red green refactor.,ideal,1,2,3,4,6,Fine.,True"),
    });
    const modelGrades = [1, 2, 3, 4];
    for (const record of result.records) {
      expect(record.humanMarks).toEqual([6]);
      expect(modelGrades).not.toContain(record.humanMarks[0]);
    }
    expect(MODEL_GRADE_COLUMNS).toContain("judge_grade");
    expect(JSON.stringify(result.records)).not.toContain("deepseek");
  });

  it("skips a row the teacher never reviewed", () => {
    const result = parseJorgpt({
      datasetCsv: csv("0,Q1,Explain TDD.,An answer.,ideal,9,9,9,9,7,,False"),
    });
    expect(result.stats.notCorrected).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it("skips an empty answer, which cannot be marked whatever its grade", () => {
    const result = parseJorgpt({ datasetCsv: csv("0,Q1,Explain TDD.,,ideal,9,9,9,9,0,Nothing written.,True") });
    expect(result.stats.emptyAnswer).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it("skips a grade outside the ten-mark scale", () => {
    const result = parseJorgpt({ datasetCsv: csv("0,Q1,Explain TDD.,An answer.,ideal,9,9,9,9,11,Good.,True") });
    expect(result.stats.outOfRange).toBe(1);
  });

  it("says so when the file carries no human column at all", () => {
    const result = parseJorgpt({ datasetCsv: "entry_id,student_answer,judge_grade\n0,An answer.,7\n" });
    expect(result.records).toHaveLength(0);
    expect(result.issues.join(" ")).toContain("no human marks");
  });
});

describe("graduate-neural-networks", () => {
  const header = ",question,student_answer,grades_round,student_modified,ref_answer,cos_similarity,question_id";
  const csv = (...rows: string[]) => [header, ...rows].join("\n");

  it("reads the question, answer, reference and grade", () => {
    const result = parseAsagGraduate({
      datasetCsv: csv("0,Define a neural network.,A parallel processor.,2,parallel processor,A neural network is...,0.91,1"),
    });
    expect(result.records[0]).toMatchObject({
      questionPrompt: "Define a neural network.",
      answer: { kind: "text", text: "A parallel processor." },
      humanMarks: [2],
      maxMarks: 2,
      markScheme: "A neural network is...",
      level: "postgraduate",
    });
  });

  /**
   * The rest of the file is the original authors' model output computed from
   * the answer. Ingesting it would put another system's opinion in the corpus
   * and hand a marker under test a precomputed similarity score.
   */
  it("ingests none of the derived feature columns", () => {
    const result = parseAsagGraduate({
      datasetCsv: csv("0,Define a neural network.,A parallel processor.,2,parallel processor,A neural network is...,0.91,1"),
    });
    const serialised = JSON.stringify(result.records[0]);
    expect(serialised).not.toContain("parallel processor,");
    expect(serialised).not.toContain("0.91");
    for (const column of DERIVED_COLUMNS) expect(serialised).not.toContain(`"${column}"`);
  });

  it("skips an empty answer rather than recording a mark with nothing to mark", () => {
    const result = parseAsagGraduate({ datasetCsv: csv("0,Define a neural network.,,0,,ref,0.1,1") });
    expect(result.stats.emptyAnswer).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it("counts the grades it kept", () => {
    const result = parseAsagGraduate({
      datasetCsv: csv(
        "0,Q,An answer.,2,mod,ref,0.9,1",
        "1,Q,Another answer.,0,mod,ref,0.2,1"
      ),
    });
    expect(result.stats.gradeDistribution).toEqual({ "0": 1, "2": 1 });
  });

  it("skips a grade outside the three-point scale", () => {
    const result = parseAsagGraduate({ datasetCsv: csv("0,Q,An answer.,5,mod,ref,0.9,1") });
    expect(result.stats.outOfRange).toBe(1);
  });
});
