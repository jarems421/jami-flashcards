import { describe, expect, it } from "vitest";
import { schemeAlignmentIssues } from "@/lib/practice/scheme-alignment";

/**
 * Whether a mark scheme is about its question.
 *
 * A paper passed structural validation on all eighteen questions, passed a
 * whole-paper audit, passed an independent re-audit returning
 * {"pass":true,"issues":[]}, and was published carrying three schemes that
 * belonged to a different paper. Every case below is taken from it.
 */
describe("catching a scheme written for another question", () => {
  const question = (over: Partial<{ id: string; prompt: string; marks: number }> = {}) => ({
    id: "q1",
    prompt: "Outline what is meant by interference as an explanation of forgetting.",
    marks: 2,
    ...over,
  });
  const item = (over: Record<string, unknown> = {}) =>
    ({ questionId: "q1", maxMarks: 2, marking: "additive", answer: "", points: [], ...over }) as never;

  const codes = (q: ReturnType<typeof question>, i: ReturnType<typeof item>) =>
    schemeAlignmentIssues(q, i).map((issue) => issue.code);

  /** q5: asked about interference, answered with STM encoding and capacity. */
  it("catches a scheme with nothing to do with the question", () => {
    expect(
      codes(question(), item({ answer: "Encoding: acoustic. Capacity: 7 +/- 2 items (approximately 5-9 items)." }))
    ).toContain("scheme_off_topic");
  });

  /** q6: asked for an experimental design, answered a serial-position scenario. */
  it("catches a scheme answering a different scenario", () => {
    expect(
      codes(
        question({
          prompt:
            "A psychologist asked participants to learn a list of 20 word pairs. Half the participants " +
            "then learned a second list of similar word pairs. Identify the experimental design used " +
            "and give one advantage of this design.",
        }),
        item({
          answer:
            "The first topics show the primacy effect because they were rehearsed and transferred to " +
            "long-term memory; the last topics show the recency effect because they remain in short-term store.",
        })
      )
    ).toContain("scheme_off_topic");
  });

  /**
   * q3: a study-group remark, marked against recycling and a head student.
   * Its prose overlap alone clears the bar; the invented figures are what give
   * it away.
   */
  it("catches figures the question never gave the candidate", () => {
    const found = codes(
      question({
        marks: 4,
        prompt:
          "A student says, 'I only revise with my study group because everyone else in the class " +
          "revises with a study group, and I do not want to look different.' Explain which type of " +
          "social influence is most likely to be operating in this situation.",
      }),
      item({
        maxMarks: 4,
        answer:
          "Normative social influence: students recycle to gain approval from peers. 68% of pupils " +
          "reported recycling after the head student's campaign, against 12% before it.",
      })
    );
    expect(found).toContain("scheme_foreign_figures");
  });

  it("passes a scheme that answers its own question", () => {
    expect(
      codes(
        question({
          marks: 4,
          prompt:
            "A psychologist studies how people solve anagrams, asking participants to think aloud " +
            "while working. Explain how the working memory model accounts for this task.",
        }),
        item({
          maxMarks: 4,
          answer:
            "The working memory model accounts for the anagram task through the central executive " +
            "directing attention, the phonological loop rehearsing the letters spoken aloud, and the " +
            "visuo-spatial sketchpad holding the letter arrangement.",
        })
      )
    ).toEqual([]);
  });

  /**
   * A one-mark identify is answered in two words and repeats almost none of its
   * question. Both of the real paper's one-mark items are correct and one of
   * them shares a tenth of its terms, so the measure starts at two marks.
   */
  it("does not flag a one-mark question with a terse answer", () => {
    expect(
      codes(
        question({
          marks: 1,
          prompt:
            "Identify the approach in psychology that emphasises the role of unconscious drives and " +
            "early childhood experiences in shaping behaviour.",
        }),
        item({ maxMarks: 1, answer: "Psychodynamic approach." })
      )
    ).toEqual([]);
  });

  /** A percentage the question itself supplies is not foreign. */
  it("allows figures the question supplied", () => {
    expect(
      codes(
        question({
          marks: 4,
          prompt: "In a study of conformity, 32% of participants conformed. Explain this conformity result.",
        }),
        item({
          maxMarks: 4,
          answer: "Award marks for explaining that 32% conformity reflects normative influence in the study of conformity.",
        })
      )
    ).not.toContain("scheme_foreign_figures");
  });
});

/**
 * Level numbers have to rise with the marks they award. The published paper
 * called its top band Level 1 and its zero band Level 5 on two of its four
 * banded questions; the ranges were contiguous, so every structural check
 * passed, and a marker reading the label awards the wrong end of the scale.
 */
describe("level numbering", () => {
  const banded = (bands: { label: string; minMarks: number; maxMarks: number }[]) =>
    schemeAlignmentIssues(
      { id: "q12", prompt: "Discuss research into maternal deprivation.", marks: 16 },
      {
        questionId: "q12",
        maxMarks: 16,
        marking: "banded",
        answer: "Discuss research into maternal deprivation, including Bowlby's findings.",
        bands,
      } as never
    ).map((issue) => issue.code);

  it("flags levels that count down as marks go up", () => {
    expect(
      banded([
        { label: "Level 5", minMarks: 0, maxMarks: 0 },
        { label: "Level 4", minMarks: 1, maxMarks: 4 },
        { label: "Level 3", minMarks: 5, maxMarks: 9 },
        { label: "Level 2", minMarks: 10, maxMarks: 13 },
        { label: "Level 1", minMarks: 14, maxMarks: 16 },
      ])
    ).toContain("bands_out_of_order");
  });

  it("accepts levels that rise with marks", () => {
    expect(
      banded([
        { label: "No creditworthy material", minMarks: 0, maxMarks: 0 },
        { label: "Level 1", minMarks: 1, maxMarks: 4 },
        { label: "Level 2", minMarks: 5, maxMarks: 9 },
        { label: "Level 3", minMarks: 10, maxMarks: 13 },
        { label: "Level 4", minMarks: 14, maxMarks: 16 },
      ])
    ).not.toContain("bands_out_of_order");
  });

  /** Bands named rather than numbered carry no ordering to check. */
  it("says nothing about unnumbered bands", () => {
    expect(
      banded([
        { label: "Limited", minMarks: 0, maxMarks: 8 },
        { label: "Thorough", minMarks: 9, maxMarks: 16 },
      ])
    ).not.toContain("bands_out_of_order");
  });
});
