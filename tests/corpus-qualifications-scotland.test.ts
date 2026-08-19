import { describe, expect, it } from "vitest";
import {
  parseMarkingInstructions,
  parseMarkStatement,
  parseQualificationsScotland,
  readCommentaryEntries,
  readCommentaryLines,
  readEvidenceIndex,
} from "@/lib/evaluation/sources/qualifications-scotland";

const footer = (page: number, of: number, kind = "Commentaries") =>
  `Mathematics HigherQuestion Paper 1 2023${kind}SQA | www.understandingstandards.org.uk${page} of ${of}`;

function commentary(...pages: string[]) {
  return pages.map((text, index) => ({ page: index + 1, text }));
}

function evidence(...pages: string[]) {
  return pages.map((text, index) => ({ page: index + 1, text }));
}

describe("reading a commentary", () => {
  /**
   * The regression that matters most in this file. The page footer is
   * extracted glued to the last word of the page, so a pattern that reaches
   * backwards to find the subject eats it — turning "Mark 3 not awarded" into
   * "Mark 3 not", which reads as a mark that was awarded.
   */
  it("strips the footer without taking the verdict glued to it", () => {
    const lines = readCommentaryLines(
      commentary(`Candidate 19\n♦ Mark 1 awarded\n♦ Mark 3 not awarded${footer(3, 6)}`)
    );
    expect(lines).toContain("♦ Mark 3 not awarded");
    expect(lines.join(" ")).not.toContain("understandingstandards");
  });

  it("folds a reason that wraps onto the next line back onto its mark", () => {
    const lines = readCommentaryLines(
      commentary("♦ Mark 2 not awarded – each line of working must be equivalent\nto the line above")
    );
    expect(lines).toEqual([
      "♦ Mark 2 not awarded – each line of working must be equivalent to the line above",
    ]);
  });

  it("carries a statement split across a page break", () => {
    const lines = readCommentaryLines(
      commentary(`♦ Mark 3 not${footer(1, 2)}`, `awarded${footer(2, 2)}`)
    );
    expect(lines).toEqual(["♦ Mark 3 not awarded"]);
  });

  it("groups bullets under the question and candidate above them", () => {
    const entries = readCommentaryEntries(
      commentary("Question 2\nCandidate 2\n♦ Mark 1 awarded\nCandidate 3\n♦ Mark 1 not awarded")
    );
    expect(entries).toEqual([
      { question: 2, candidate: 2, lines: ["♦ Mark 1 awarded"] },
      { question: 2, candidate: 3, lines: ["♦ Mark 1 not awarded"] },
    ]);
  });
});

describe("reading a mark statement", () => {
  it("reads a mark awarded", () => {
    expect(parseMarkStatement("♦ Mark 1 awarded")).toEqual({
      kind: "criteria",
      criteria: [{ id: "Mark 1", available: 1, awarded: 1 }],
    });
  });

  it("reads a mark withheld, with the examiner's reason", () => {
    expect(parseMarkStatement("♦ Mark 2 not awarded – error in gradient formula")).toEqual({
      kind: "criteria",
      criteria: [
        { id: "Mark 2", available: 1, awarded: 0, reason: "error in gradient formula" },
      ],
    });
  });

  it("splits a run of marks sharing one verdict", () => {
    const statement = parseMarkStatement("♦ Marks 3, 4 and 5 awarded");
    expect(statement.kind === "criteria" && statement.criteria.map((c) => c.id)).toEqual([
      "Mark 3",
      "Mark 4",
      "Mark 5",
    ]);
  });

  /** The source writes the singular with a list too. */
  it("reads a list written as 'Mark' rather than 'Marks'", () => {
    const statement = parseMarkStatement("♦ Mark 2 and 3 not awarded");
    expect(statement.kind === "criteria" && statement.criteria.every((c) => c.awarded === 0)).toBe(true);
    expect(statement.kind === "criteria" && statement.criteria).toHaveLength(2);
  });

  it("records follow-through, including the source's own misspelling", () => {
    for (const line of ["♦ Mark 2 awarded on follow-through", "♦ Mark 2 awarded on follow-though"]) {
      const statement = parseMarkStatement(line);
      expect(statement.kind === "criteria" && statement.criteria[0]).toMatchObject({
        awarded: 1,
        followThrough: true,
      });
    }
  });

  /** Some questions are commented on as a fraction, not mark by mark. */
  it("reads a fraction, keeping the marks available", () => {
    expect(parseMarkStatement("♦ 1/2 awarded – this is a graph of f(x)")).toEqual({
      kind: "criteria",
      criteria: [
        { id: "Marks 1-2", available: 2, awarded: 1, reason: "this is a graph of f(x)" },
      ],
    });
  });

  /**
   * A bullet with no verdict is a note about the question, not a judgement on
   * a mark. Counting it either way would invent an examiner decision.
   */
  it("refuses to guess at a bullet that states no verdict", () => {
    expect(parseMarkStatement("♦ Marks 4, 5 and 6 – the same marks are available in both attempts")).toEqual({
      kind: "unreadable",
      text: "Marks 4, 5 and 6 – the same marks are available in both attempts",
    });
  });
});

describe("matching evidence to commentary", () => {
  it("indexes each candidate to the pages their script occupies", () => {
    const index = readEvidenceIndex(
      evidence("Question 1\nCandidate 1", "Candidate 2", "Candidate 3")
    );
    expect(index.get(1)).toEqual({ question: 1, firstPage: 1, lastPage: 1, sharesPage: false });
    expect(index.get(3)).toEqual({ question: 1, firstPage: 3, lastPage: 3, sharesPage: false });
  });

  it("flags a page holding more than one candidate rather than splitting it", () => {
    const index = readEvidenceIndex(evidence("Question 1\nCandidate 1\nCandidate 2", "Candidate 3"));
    expect(index.get(1)).toMatchObject({ firstPage: 1, lastPage: 1, sharesPage: true });
  });
});

/**
 * The marking instructions are a four-column table. Reading order interleaves
 * the generic and illustrative schemes, both of which bullet their entries
 * identically, so only position tells them apart.
 */
describe("reading the marking instructions", () => {
  const at = (x: number, y: number, text: string) => ({ x, y, text });

  /** Question column ~47, generic ~125-200, illustrative ~309+, max ~504. */
  const instructions = [
    {
      page: 1,
      items: [
        at(59, 779, "Question"),
        at(171, 780, "Generic scheme"),
        at(348, 780, "Illustrative scheme"),
        at(497, 784, "Max"),
        at(47, 752, "5."),
        at(504, 752, "3"),
        at(125, 747, "•"),
        at(130, 751, "1 "),
        at(139, 747, "use the discriminant"),
        at(309, 747, "b2 − 4ac"),
        at(125, 714, "•"),
        at(130, 718, "2 "),
        at(139, 714, "apply condition and express in"),
        at(139, 700, "standard quadratic form"),
        at(125, 672, "•"),
        at(130, 676, "3 "),
        at(139, 672, "process for p"),
        at(47, 645, "Notes:"),
        at(47, 630, "1."),
        at(65, 630, "Where candidates state an incorrect condition"),
        at(139, 615, "this text is below the table and is not a mark"),
      ],
    },
  ];

  it("reads what each mark is for, and the question's tariff", () => {
    const schemes = parseMarkingInstructions(instructions);
    expect(schemes.get(5)).toEqual({
      tariff: 3,
      descriptions: [
        "use the discriminant",
        "apply condition and express in standard quadratic form",
        "process for p",
      ],
    });
  });

  it("takes only the generic scheme, not the illustrative one beside it", () => {
    const schemes = parseMarkingInstructions(instructions);
    expect(schemes.get(5)?.descriptions.join(" ")).not.toContain("b2 − 4ac");
  });

  /**
   * The notes under each table number themselves "1.", "2." in the question
   * column. Reading one as a question silently reassigns every description
   * after it, so the tariff in the last column is what identifies a real
   * question row.
   */
  it("does not mistake a numbered note for a new question", () => {
    const schemes = parseMarkingInstructions(instructions);
    expect(schemes.has(1)).toBe(false);
  });

  it("ignores everything below the table", () => {
    const schemes = parseMarkingInstructions(instructions);
    expect(schemes.get(5)?.descriptions.join(" ")).not.toContain("below the table");
  });

  it("keeps the table's own header out of the last description", () => {
    const schemes = parseMarkingInstructions(instructions);
    expect(schemes.get(5)?.descriptions.at(-1)).toBe("process for p");
  });

  /** A mark number is drawn above its own bullet, so it cannot anchor a line. */
  it("starts a new mark from the bullet's position, not its number", () => {
    const schemes = parseMarkingInstructions(instructions);
    expect(schemes.get(5)?.descriptions).toHaveLength(3);
  });

  it("sums the tariff of a question that runs over two pages", () => {
    const second = {
      page: 2,
      items: [at(47, 752, "5."), at(504, 752, "5"), at(125, 747, "•"), at(139, 747, "second part")],
    };
    const schemes = parseMarkingInstructions([...instructions, second]);
    expect(schemes.get(5)?.tariff).toBe(8);
    expect(schemes.get(5)?.descriptions).toHaveLength(4);
  });
});

describe("qualifications-scotland records", () => {
  const paper = {
    id: "paper-1",
    evidenceFile: "/evidence.pdf",
    commentaryPages: commentary(
      "Question 2\nCandidate 2\n♦ Mark 1 awarded\n♦ Mark 2 not awarded – error in gradient formula\n♦ Marks 3 and 4 awarded on follow-through"
    ),
    evidencePages: evidence("Question 2\nCandidate 2"),
  };
  const input = { seriesId: "higher-maths-2023", subject: "maths", papers: [paper] };

  it("builds one criterion-level record per candidate", () => {
    const { records } = parseQualificationsScotland(input);
    expect(records[0]).toMatchObject({
      id: "qs:higher-maths-2023:paper-1:q2:c2",
      sourceId: "qualifications-scotland",
      regime: "additive",
      questionId: "q2",
      humanMarks: [3],
      maxMarks: 4,
    });
    expect(records[0].criteria).toEqual([
      { id: "Mark 1", available: 1, awarded: 1 },
      { id: "Mark 2", available: 1, awarded: 0, reason: "error in gradient formula" },
      { id: "Mark 3", available: 1, awarded: 1, followThrough: true },
      { id: "Mark 4", available: 1, awarded: 1, followThrough: true },
    ]);
  });

  it("points the answer at the candidate's pages in the evidence PDF", () => {
    const { records } = parseQualificationsScotland(input);
    expect(records[0].answer).toEqual({ kind: "image", paths: ["/evidence.pdf#page=1"] });
  });

  it("writes the mark-by-mark reasoning out as the examiner's commentary", () => {
    const { records } = parseQualificationsScotland(input);
    expect(records[0].examinerCommentary).toContain("Mark 2: not awarded — error in gradient formula");
    expect(records[0].examinerCommentary).toContain("Mark 3: awarded on follow-through");
  });

  /**
   * A commentary that rules on three of five marks says nothing about the
   * other two. Counting them as refused would invent a judgement, so the
   * record is out of what was actually ruled on and the shortfall is reported.
   */
  it("marks a candidate out of what the examiner actually ruled on", () => {
    const partial = {
      ...paper,
      commentaryPages: commentary(
        "Question 4\nCandidate 9\n♦ Mark 1 not awarded\n♦ Mark 2 awarded\nCandidate 10\n♦ Mark 1 awarded\n♦ Marks 2, 3, 4 and 5 awarded"
      ),
      evidencePages: evidence("Question 4\nCandidate 9", "Candidate 10"),
    };
    const result = parseQualificationsScotland({ ...input, papers: [partial] });
    const candidate9 = result.records.find((record) => record.id.endsWith("c9"))!;
    expect(candidate9.maxMarks).toBe(2);
    expect(candidate9.humanMarks).toEqual([1]);
    expect(result.stats.partialCommentary).toBe(1);
    expect(result.issues.join(" ")).toContain("rules on 2 of question 4's 5 marks");
  });

  /**
   * The commentary carries no working and the evidence carries no marks, so a
   * record only means anything if both name the same question. A mark pinned
   * to the wrong script is worse than no record.
   */
  it("drops a candidate the two files disagree about", () => {
    const mismatched = { ...paper, evidencePages: evidence("Question 7\nCandidate 2") };
    const result = parseQualificationsScotland({ ...input, papers: [mismatched] });
    expect(result.records).toHaveLength(0);
    expect(result.stats.questionMismatches).toBe(1);
  });

  it("drops a candidate with no script at all", () => {
    const missing = { ...paper, evidencePages: evidence("Question 2\nCandidate 5") };
    const result = parseQualificationsScotland({ ...input, papers: [missing] });
    expect(result.records).toHaveLength(0);
    expect(result.stats.unmatchedEvidence).toBe(1);
  });

  it("counts the criteria and how many carry a reason", () => {
    const { stats } = parseQualificationsScotland(input);
    expect(stats.criteria).toBe(4);
    expect(stats.criteriaWithReason).toBe(1);
    expect(stats.followThrough).toBe(2);
  });
});

/**
 * A criterion is only useful if it says what the mark was for as well as what
 * happened to it. That text comes from a different file than the verdict, so
 * the two have to be lined up — and where they cannot be, saying nothing beats
 * describing every mark as the wrong one.
 */
describe("attaching the scheme to the verdicts", () => {
  const at = (x: number, y: number, text: string) => ({ x, y, text });
  const scheme = (...marks: string[]) => [
    {
      page: 1,
      items: [
        at(47, 752, "2."),
        at(504, 752, String(marks.length)),
        ...marks.flatMap((mark, index) => [
          at(125, 700 - index * 30, "•"),
          at(139, 700 - index * 30, mark),
        ]),
      ],
    },
  ];

  const paper = {
    id: "paper-1",
    evidenceFile: "/evidence.pdf",
    commentaryPages: [
      {
        page: 1,
        text: "Question 2\nCandidate 2\n♦ Mark 1 awarded\n♦ Mark 2 not awarded – error in gradient formula",
      },
    ],
    evidencePages: [{ page: 1, text: "Question 2\nCandidate 2" }],
  };
  const input = { seriesId: "higher-maths-2023", subject: "maths", papers: [paper] };

  it("says what each mark was for alongside what the examiner did with it", () => {
    const result = parseQualificationsScotland({
      ...input,
      papers: [{ ...paper, instructionPages: scheme("find midpoint of PQ", "calculate gradient of PQ") }],
    });
    expect(result.records[0].criteria).toEqual([
      { id: "Mark 1", available: 1, awarded: 1, description: "find midpoint of PQ" },
      {
        id: "Mark 2",
        available: 1,
        awarded: 0,
        description: "calculate gradient of PQ",
        reason: "error in gradient formula",
      },
    ]);
    expect(result.stats.describedCriteria).toBe(2);
  });

  it("writes the description into the commentary too", () => {
    const result = parseQualificationsScotland({
      ...input,
      papers: [{ ...paper, instructionPages: scheme("find midpoint of PQ", "calculate gradient of PQ") }],
    });
    expect(result.records[0].examinerCommentary).toContain("Mark 1 (find midpoint of PQ): awarded");
  });

  /**
   * Some questions list alternative methods, each restarting its bullets, so
   * the scheme holds more entries than the commentary numbers. Pairing those
   * by position would give every mark somebody else's description.
   */
  it("withholds descriptions when the scheme and commentary do not line up", () => {
    const result = parseQualificationsScotland({
      ...input,
      papers: [{ ...paper, instructionPages: scheme("method 1 step", "method 1 step 2", "method 2 step") }],
    });
    expect(result.records[0].criteria?.every((criterion) => !criterion.description)).toBe(true);
    expect(result.stats.describedCriteria).toBe(0);
    expect(result.issues.join(" ")).toContain("descriptions withheld");
  });

  it("still produces records when no marking instructions are supplied", () => {
    const result = parseQualificationsScotland(input);
    expect(result.records).toHaveLength(1);
    expect(result.stats.describedCriteria).toBe(0);
  });
});

/**
 * The corpus used to hand a marker a photograph of somebody's working and a
 * list reading "Mark 1 ... Mark 7", with no question and no scheme, because
 * neither survives extraction from the source PDFs. They arrive transcribed
 * instead, and the parser's job is to line them up with the commentaries
 * without ever pairing a mark to somebody else's description.
 */
describe("attaching the transcribed question and scheme", () => {
  const transcript = [
    {
      questionId: "13(a)",
      prompt: "Functions f and g are defined by f(x) = 2 sin x.",
      scheme: "Generic: state the composite function.",
      marks: [{ id: "Mark 1", description: "interpret composite function" }],
    },
    {
      questionId: "13(b)",
      prompt: "Given that f(p) = 1/3, determine sin p.",
      scheme: "Generic: apply the double angle formula.",
      marks: [
        { id: "Mark 1", description: "apply double angle formula" },
        { id: "Mark 2", description: "state exact value" },
      ],
    },
  ];

  const at = (x: number, y: number, text: string) => ({ x, y, text });
  const scheme = (...marks: string[]) => [
    {
      page: 1,
      items: [
        at(47, 752, "13."),
        at(504, 752, String(marks.length)),
        ...marks.flatMap((mark, index) => [
          at(125, 700 - index * 30, "•"),
          at(139, 700 - index * 30, mark),
        ]),
      ],
    },
  ];

  const paperWith = (statement: string) => ({
    id: "paper-1",
    evidenceFile: "/evidence.pdf",
    commentaryPages: [{ page: 1, text: `Question 13\nCandidate 2\n${statement}` }],
    evidencePages: [{ page: 1, text: "Question 13\nCandidate 2" }],
    transcript,
  });
  const input = (statement: string) => ({
    seriesId: "higher-maths-2023",
    subject: "maths",
    papers: [paperWith(statement)],
  });

  it("joins the parts a commentary rules on, and numbers their marks straight through", () => {
    const result = parseQualificationsScotland(
      input("♦ Mark 1 awarded\n♦ Mark 2 awarded\n♦ Mark 3 not awarded")
    );
    const record = result.records[0];
    expect(record.questionPrompt).toContain("2 sin x");
    expect(record.questionPrompt).toContain("determine sin p");
    expect(record.markScheme).toContain("double angle");
    expect(record.criteria?.map((criterion) => criterion.description)).toEqual([
      "interpret composite function",
      "apply double angle formula",
      "state exact value",
    ]);
  });

  /**
   * Eleven commentaries stop before the end of their question. Each is a
   * prefix, so a commentary of one mark is ruling on 13(a) and must not be
   * shown 13(b)'s scheme for work it was never asked to judge.
   */
  it("shows a partial commentary only the parts it covers", () => {
    const result = parseQualificationsScotland(input("♦ Mark 1 awarded"));
    const record = result.records[0];
    expect(record.questionPrompt).toContain("2 sin x");
    expect(record.questionPrompt).not.toContain("determine sin p");
    expect(record.markScheme).not.toContain("double angle");
  });

  /**
   * Fails closed. Where the parts cannot be made to add up, the marks are
   * numbered differently on the two sides and attaching anything would label
   * every mark as the wrong one — quieter and worse than attaching nothing.
   */
  it("withholds the question when the parts do not add up to the marks ruled on", () => {
    const result = parseQualificationsScotland(input("♦ Mark 1 awarded\n♦ Mark 2 awarded"));
    const record = result.records[0];
    expect(record.questionPrompt).toBe("");
    expect(record.markScheme).toBeUndefined();
    expect(result.issues.join(" ")).toContain("do not add up");
  });

  /**
   * Both readers see the same bullet and agree on its words; only the
   * transcription gets the spaces, because positioned text arrives with the
   * gaps between runs missing. The instruction reader turned "calculate
   * y-coordinate" into "calculatey-coordinate", and a marker should not be
   * told to look for a word that is not a word.
   */
  it("prefers the transcribed description over the instruction reader's spacing", () => {
    const result = parseQualificationsScotland({
      seriesId: "higher-maths-2023",
      subject: "maths",
      papers: [
        {
          ...paperWith("♦ Mark 1 awarded"),
          instructionPages: scheme("interpretcomposite function"),
        },
      ],
    });
    expect(result.records[0].criteria?.[0].description).toBe("interpret composite function");
    expect(result.stats.describedCriteria).toBe(1);
  });

  it("still produces records when no transcript is supplied", () => {
    const result = parseQualificationsScotland({
      seriesId: "higher-maths-2023",
      subject: "maths",
      papers: [{ ...paperWith("♦ Mark 1 awarded"), transcript: undefined }],
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].questionPrompt).toBe("");
  });
});
