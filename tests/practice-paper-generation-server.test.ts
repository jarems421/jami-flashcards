import { describe, expect, it } from "vitest";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import { sectionKey, sectionMarkIssues } from "@/lib/practice/exam-formats";
import {
  applyPracticePaperAuditRepairPatch,
  canonicalizeGeneratedMarkSchemeItems,
  normalizeGeneratedMarkSchemeBatch,
  partitionMarkSchemeQuestions,
} from "@/lib/ai/practice-paper-generation";

describe("practice-paper generation provider normalization", () => {
  it("merges a compact audit patch without repeating unaffected questions", () => {
    const paper = {
      status: "ready",
      title: "Paper",
      instructions: ["Answer all questions."],
      durationMinutes: 60,
      questions: [
        { id: "q1", prompt: "Original one", marks: 1 },
        { id: "q2", prompt: "Original two", marks: 2 },
      ],
      markScheme: {
        items: [
          { questionId: "q1", marking: "additive", points: [] },
          { questionId: "q2", marking: "additive", points: [] },
        ],
      },
    } as never;

    const merged = applyPracticePaperAuditRepairPatch(paper, {
      topLevel: { durationMinutes: 75 },
      replacements: [{
        question: { questionId: "q2", prompt: "Repaired two", marks: 2 },
        markScheme: {
          questionId: "q2",
          marking: "additive",
          points: [{ id: "q2.p1", marks: 2, code: "A", text: "Answer" }],
        },
      }],
    }) as {
      durationMinutes: number;
      questions: Array<Record<string, unknown>>;
      markScheme: { items: Array<Record<string, unknown>> };
    };

    expect(merged.durationMinutes).toBe(75);
    expect(merged.questions).toEqual([
      expect.objectContaining({ id: "q1", prompt: "Original one" }),
      expect.objectContaining({ id: "q2", prompt: "Repaired two" }),
    ]);
    expect(merged.markScheme.items[0]).toEqual(
      expect.objectContaining({ questionId: "q1" })
    );
    expect(merged.markScheme.items[1]).toEqual(
      expect.objectContaining({ questionId: "q2", points: expect.any(Array) })
    );
  });

  it("canonicalizes MiMo mark-scheme aliases without weakening validation", () => {
    expect(canonicalizeGeneratedMarkSchemeItems([{
      id: "q1",
      markingModel: "additive",
      maxMarks: 2,
      answer: "4",
      points: [{
        id: "q1.a1",
        marks: 1,
        code: "A",
        text: "Correct answer",
        dep: "q1.m1",
        ft: null,
        essentialTerms: null,
        allow: "4",
        reject: null,
      }],
    }])).toEqual([expect.objectContaining({
      questionId: "q1",
      marking: "additive",
      points: [expect.objectContaining({
        dep: ["q1.m1"],
        ft: false,
        essentialTerms: [],
        allow: ["4"],
        reject: [],
      })],
    })]);
  });

  it("canonicalizes a nested provider marking object", () => {
    expect(canonicalizeGeneratedMarkSchemeItems([{
      questionId: "q1",
      marking: {
        type: "additive",
        points: [{
          id: "q1.p1",
          marks: 1,
          code: "B",
          text: "Valid point",
          dep: [],
          ft: [],
          essentialTerms: [],
          allow: [],
          reject: [],
        }],
      },
    }])).toEqual([expect.objectContaining({
      marking: "additive",
      points: [expect.objectContaining({ ft: false })],
    })]);
  });

  it("infers a known model from unmistakable nested scoring fields", () => {
    expect(canonicalizeGeneratedMarkSchemeItems([{
      questionId: "q1",
      marking: {
        levels: [
          { id: "l0", minMarks: 0, maxMarks: 0, descriptor: "No credit" },
          { id: "l1", minMarks: 1, maxMarks: 4, descriptor: "Some relevant knowledge" },
        ],
      },
    }])).toEqual([expect.objectContaining({
      marking: "banded",
      bands: expect.any(Array),
    })]);
  });

  it("normalizes band aliases and removes impossible method dependencies", () => {
    const [banded, additive] = canonicalizeGeneratedMarkSchemeItems([{
      questionId: "q1",
      marking: "levels",
      levels: [{ min: 0, max: 4, description: "Some relevant knowledge" }],
    }, {
      questionId: "q2",
      marking: "additive",
      points: [
        { id: "a1", marks: 1, code: "A", text: "Accurate conclusion", dep: [] },
        { id: "m1", marks: 1, code: "M", text: "Valid method", dep: ["a1"] },
      ],
    }]) as Array<Record<string, unknown>>;

    expect(banded).toEqual(expect.objectContaining({
      marking: "banded",
      bands: [expect.objectContaining({ minMarks: 0, maxMarks: 4, descriptor: "Some relevant knowledge" })],
    }));
    expect(additive.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "m1", dep: [] }),
    ]));
  });

  it("balances additive point weights to the fixed question maximum", () => {
    const [item] = canonicalizeGeneratedMarkSchemeItems([{
      questionId: "q1",
      maxMarks: 4,
      marking: "additive",
      points: [
        { id: "p1", marks: 2, code: "B", text: "First criterion" },
        { id: "p2", marks: 2, code: "B", text: "Second criterion" },
        { id: "p3", marks: 2, code: "B", text: "Third criterion" },
      ],
    }]) as Array<Record<string, unknown>>;
    const total = (item.points as Array<Record<string, unknown>>)
      .reduce((sum, point) => sum + Number(point.marks), 0);

    expect(total).toBe(4);
    expect((item.points as Array<Record<string, unknown>>)).toHaveLength(3);
  });

  /**
   * An extended-response question gets a call to itself. Batched with a
   * neighbour it crowds the neighbour out: a six-mark and a twelve-mark
   * question travelled together at eighteen marks, inside the twenty-mark cap,
   * and the model returned a scheme for one of the two. The batch was rejected
   * for holding one item where two were required, the retry returned one
   * again, and the paper failed.
   *
   * The marks cap alone cannot express this, which is why this assertion used
   * to pair a four-mark question with a sixteen-mark one and still pass under
   * the name it has.
   */
  it("isolates high-mark questions so mark-scheme calls stay bounded", () => {
    const questions = [
      { id: "q1", marks: 4 },
      { id: "q2", marks: 4 },
      { id: "q3", marks: 4 },
      { id: "q4", marks: 16 },
      { id: "q5", marks: 16 },
      { id: "q6", marks: 2 },
    ];

    expect(partitionMarkSchemeQuestions(questions).map((batch) => batch.map((item) => item.id)))
      .toEqual([["q1", "q2"], ["q3"], ["q4"], ["q5"], ["q6"]]);
  });

  /** The threshold is a setting, since boards put their extended tariff differently. */
  it("keeps ordinary questions batched together", () => {
    const questions = [
      { id: "q1", marks: 2 },
      { id: "q2", marks: 4 },
      { id: "q3", marks: 6 },
      { id: "q4", marks: 12 },
    ];
    expect(
      partitionMarkSchemeQuestions(questions, { isolateAtOrAbove: 20 })
        .map((batch) => batch.map((item) => item.id))
    ).toEqual([["q1", "q2"], ["q3", "q4"]]);
  });

  it("rejects an unreadable mark-scheme batch before whole-paper repair", () => {
    const questions = [{
      id: "q1",
      label: "Question 1",
      prompt: "State one limitation of laboratory experiments.",
      marks: 2,
      assets: [],
    }];

    expect(normalizeGeneratedMarkSchemeBatch([{
      questionId: "q1",
      marking: "unsupported-shape",
    }], questions)).toBeNull();
    expect(normalizeGeneratedMarkSchemeBatch([{
      questionId: "q1",
      maxMarks: 2,
      answer: "Artificial settings can reduce ecological validity.",
      acceptableAlternatives: [],
      commonMistakes: [],
      marking: "additive",
      points: [
        { id: "q1.p1", marks: 1, code: "B", text: "Identifies a limitation", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
        { id: "q1.p2", marks: 1, code: "A", text: "Explains its consequence", dep: ["q1.p1"], ft: false, essentialTerms: [], allow: [], reject: [] },
      ],
    }], questions)).toEqual([expect.objectContaining({ questionId: "q1", marking: "additive" })]);
  });
});

/**
 * A question could not say which section it belonged to, so a profile
 * describing "four sections of 24 marks each" described something the paper
 * format could not represent. The designer answered with a flat list and
 * nothing held it to the section totals: ten drafts of the same 96-mark
 * component came back at 80, 96, 97, 136, 143, 154, 164, 169, 177 and 178
 * marks. One in ten was right.
 */
describe("a question that knows its section", () => {
  const paper = (questions: { id: string; section?: string; marks: number }[]) =>
    mapPracticePaperData("p1", {
      notebookId: "p1",
      folderId: "f1",
      title: "Paper",
      status: "submitted",
      questions: questions.map((q) => ({
        id: q.id,
        label: q.id.toUpperCase(),
        prompt: "Answer.",
        marks: q.marks,
        ...(q.section ? { section: q.section } : {}),
      })),
    });

  it("keeps the section it was given", () => {
    const built = paper([{ id: "q1", section: "A", marks: 24 }]);
    expect(built.questions[0].section).toBe("A");
  });

  /** Plenty of papers have no sections, and every stored paper predates this. */
  it("leaves it off where the format has none", () => {
    expect(paper([{ id: "q1", marks: 24 }]).questions[0].section).toBeUndefined();
  });

  /**
   * Through the helper generation actually uses. Summing the questions inline
   * here would pass whatever the shipped check did.
   */
  it("adds up a section from the questions that name it", () => {
    const built = paper([
      { id: "q1", section: "A", marks: 2 },
      { id: "q2", section: "A", marks: 4 },
      { id: "q3", section: "B", marks: 6 },
    ]);
    const totals = new Map<string, number>();
    for (const q of built.questions) {
      if (!q.section) continue;
      const key = sectionKey(q.section);
      totals.set(key, (totals.get(key) ?? 0) + q.marks);
    }
    expect(totals.get("a")).toBe(6);
    expect(totals.get("b")).toBe(6);
  });

  /**
   * The designer is told to send the bare id, and the first draft that used
   * sections at all still got their sizes wrong -- so the naming will not always
   * be clean either. A paper built correctly must not be thrown away and
   * refunded over the word "Section".
   */
  it("counts a section however the designer spelled it", () => {
    const built = paper([
      { id: "q1", section: "Section A", marks: 2 },
      { id: "q2", section: "A.", marks: 4 },
      { id: "q3", section: "a", marks: 6 },
    ]);
    const totals = new Map<string, number>();
    for (const q of built.questions) {
      if (!q.section) continue;
      const key = sectionKey(q.section);
      totals.set(key, (totals.get(key) ?? 0) + q.marks);
    }
    expect(totals.get("a")).toBe(12);
    expect(totals.size).toBe(1);
  });

  /** A title the profile does not use is a real mismatch and must still fail. */
  it("does not quietly fold a title into a section id", () => {
    expect(sectionKey("Social influence")).not.toBe(sectionKey("A"));
    expect(sectionKey("Sections")).toBe("sections");
  });
});

/**
 * The check that decides whether a draft is the paper the profile describes,
 * exercised through the function generation actually calls. Every case below
 * is a shape a real pilot run produced.
 */
describe("holding a draft to the sections the profile lists", () => {
  const aqaPaper1 = [
    { id: "A", title: "Social influence", marks: 24 },
    { id: "B", title: "Memory", marks: 24 },
    { id: "C", title: "Attachment", marks: 24 },
    { id: "D", title: "Approaches in Psychology", marks: 24 },
  ];
  const evenly = (marks: number, sections: string[]) =>
    sections.flatMap((section) => [
      { section, marks: marks / 2 },
      { section, marks: marks / 2 },
    ]);

  it("passes a paper whose sections each hit their figure", () => {
    const { wrong } = sectionMarkIssues(evenly(24, ["A", "B", "C", "D"]), aqaPaper1);
    expect(wrong).toEqual([]);
  });

  /** The first draft that used sections at all: even, and half as big again. */
  it("rejects 43/41/41/43 against a required 24 each", () => {
    const { wrong } = sectionMarkIssues(
      [
        { section: "A", marks: 43 },
        { section: "B", marks: 41 },
        { section: "C", marks: 41 },
        { section: "D", marks: 43 },
      ],
      aqaPaper1
    );
    expect(wrong).toHaveLength(4);
    expect(wrong[0]).toEqual({ section: "A", expected: 24, actual: 43 });
  });

  /**
   * A retry labelled its sections "Social influence" and "Memory" rather than
   * A and B. Refusing that paper would cost a run over a naming choice.
   */
  it("accepts sections named by title instead of id", () => {
    const { wrong } = sectionMarkIssues(
      evenly(24, ["Social influence", "Memory", "Attachment", "Approaches in Psychology"]),
      aqaPaper1
    );
    expect(wrong).toEqual([]);
  });

  it("accepts a section however it is spelled", () => {
    const { wrong } = sectionMarkIssues(
      evenly(24, ["Section A", "b.", " C ", "section d"]),
      aqaPaper1
    );
    expect(wrong).toEqual([]);
  });

  /**
   * The case the paper total cannot catch: 96 marks overall, and no section
   * the right size.
   */
  it("rejects a paper that is right overall and wrong throughout", () => {
    const questions = [
      { section: "A", marks: 12 },
      { section: "B", marks: 12 },
      { section: "C", marks: 36 },
      { section: "D", marks: 36 },
    ];
    expect(questions.reduce((sum, q) => sum + q.marks, 0)).toBe(96);
    expect(sectionMarkIssues(questions, aqaPaper1).wrong).toHaveLength(4);
  });

  /** A flat list naming no sections at all -- every earlier draft. */
  it("rejects a draft that names no sections", () => {
    const { wrong } = sectionMarkIssues([{ marks: 96 }], aqaPaper1);
    expect(wrong.map((entry) => entry.actual)).toEqual([0, 0, 0, 0]);
  });

  /** What the log reports, so a naming fault reads differently from a sizing one. */
  it("reports what it did build, not only what was missing", () => {
    const { built } = sectionMarkIssues(
      [{ section: "Section A", marks: 24 }, { section: "Quantitative", marks: 12 }],
      aqaPaper1
    );
    expect(built.get("A")).toBe(24);
    expect(built.get("Quantitative")).toBe(12);
  });
});

/**
 * Batching the paper the profile actually describes.
 *
 * The verified AQA Psychology Paper 1 profile records the June 2022 tariffs as
 * A 3+1+4+16, B 2+2+4+16, C 2+2+4+16, D 6+3+2+1+4+8 -- eighteen questions, three
 * of them 16-mark extended answers. No run has reached the mark-scheme stage
 * with this shape, so what it partitions into is worth stating rather than
 * discovering during a paid run.
 */
describe("batching the real Paper 1 shape", () => {
  const paper1 = [3, 1, 4, 16, 2, 2, 4, 16, 2, 2, 4, 16, 6, 3, 2, 1, 4, 8].map(
    (marks, index) => ({ id: `q${index + 1}`, marks })
  );

  it("gives every 16-mark extended question a batch of its own", () => {
    const batches = partitionMarkSchemeQuestions(paper1);
    for (const batch of batches) {
      if (batch.some((question) => question.marks >= 12)) expect(batch).toHaveLength(1);
    }
    expect(batches.filter((batch) => batch[0].marks === 16)).toHaveLength(3);
  });

  it("keeps every question exactly once", () => {
    const batches = partitionMarkSchemeQuestions(paper1);
    expect(batches.flat().map((question) => question.id)).toEqual(
      paper1.map((question) => question.id)
    );
  });

  /** Twelve calls, each resumable from its checkpoint if the provider drops. */
  it("costs twelve scheme calls", () => {
    expect(partitionMarkSchemeQuestions(paper1)).toHaveLength(12);
  });

  /** No batch may exceed the marks cap, or the scheme truncates mid-answer. */
  it("keeps a batch inside the marks cap", () => {
    for (const batch of partitionMarkSchemeQuestions(paper1)) {
      const marks = batch.reduce((sum, question) => sum + question.marks, 0);
      if (batch.length > 1) expect(marks).toBeLessThanOrEqual(20);
    }
  });
});

/**
 * Bands the model got right and the parser threw away.
 *
 * A complete 96-mark paper reached the mark-scheme stage and failed on two of
 * its three 16-mark essays with bands_do_not_cover. Both were correct: q8 came
 * back 0-2, 3-5, 6-9, 10-13, 14-16 and q12 came back 0-1, 2-3, 4-6, 7-9, 10-12,
 * 13-14, 15-16, each contiguous and covering the question exactly. Every band
 * normalised to 0-0.
 *
 * The canonicaliser mapped min/max to minMarks/maxMarks and the result was
 * applied only when the item carried no bands of its own -- so the shape the
 * models actually return was the one it never fixed. These are the captured
 * responses.
 */
describe("reading the bands a model actually returns", () => {
  const bandsOf = (raw: Record<string, unknown>) => {
    const [item] = canonicalizeGeneratedMarkSchemeItems([raw]) as {
      bands?: { minMarks?: number; maxMarks?: number }[];
    }[];
    return (item.bands ?? []).map((band) => `${band.minMarks}-${band.maxMarks}`);
  };

  it("reads min and max on bands the item carries itself", () => {
    expect(
      bandsOf({
        questionId: "q8",
        maxMarks: 16,
        marking: "banded",
        bands: [
          { id: "b0", min: 0, max: 2, descriptor: "No relevant content." },
          { id: "b1", min: 3, max: 5, descriptor: "Limited." },
          { id: "b2", min: 6, max: 9, descriptor: "Reasonable." },
          { id: "b3", min: 10, max: 13, descriptor: "Good." },
          { id: "b4", min: 14, max: 16, descriptor: "Excellent." },
        ],
      })
    ).toEqual(["0-2", "3-5", "6-9", "10-13", "14-16"]);
  });

  it("still reads bands that arrive nested under marking", () => {
    expect(
      bandsOf({
        questionId: "q12",
        maxMarks: 8,
        marking: { type: "banded", bands: [{ min: 0, max: 4 }, { min: 5, max: 8 }] },
      })
    ).toEqual(["0-4", "5-8"]);
  });

  /** The other vocabulary from the same run: one string, not two numbers. */
  it("reads a band written as a range string", () => {
    expect(
      bandsOf({
        questionId: "q4",
        maxMarks: 16,
        marking: "banded",
        bands: [
          { band: "0-3", description: "Limited." },
          { band: "4-8", description: "Reasonable." },
          { band: "9–16", description: "Good." },
        ],
      })
    ).toEqual(["0-3", "4-8", "9-16"]);
  });

  /** An explicit minMarks must still win over anything inferred. */
  it("prefers the explicit field", () => {
    expect(bandsOf({
      questionId: "q1", maxMarks: 4, marking: "banded",
      bands: [{ minMarks: 0, maxMarks: 2, min: 9, max: 9 }],
    })).toEqual(["0-2"]);
  });

  /** A band that says nothing readable must not silently become 0-0. */
  it("leaves an unreadable band unreadable rather than scoring it zero", () => {
    const [band] = bandsOf({
      questionId: "q1", maxMarks: 4, marking: "banded",
      bands: [{ descriptor: "Good work." }],
    });
    expect(band).toBe("undefined-undefined");
  });
});
