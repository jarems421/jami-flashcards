import { describe, expect, it } from "vitest";
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
