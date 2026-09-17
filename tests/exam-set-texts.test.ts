import { describe, expect, it } from "vitest";
import {
  examSetTextCatalogue,
  filterCanonicalSetTextIds,
  matchExamSetText,
  matchSetTextIn,
  servableExamSetTexts,
  uniqueSetTextIn,
  specificationSetsTexts,
} from "@/lib/practice/exam-set-texts";
import { buildExamCourseSelection, questionMatchesExamCourse, type ExamQuestion } from "@/lib/practice/exam-questions";

/**
 * A literature paper prints a question on every set text and the student
 * answers the one on theirs. Drawing them a question on Jane Eyre when they
 * studied Macbeth is not a hard question; it is an unanswerable one.
 */
describe("the set texts a course offers", () => {
  const catalogue = examSetTextCatalogue("8702")!;

  it("lists every text the specification sets, grouped by the choice it belongs to", () => {
    const choices = new Map<string, number>();
    for (const text of catalogue.texts) choices.set(text.choice, (choices.get(text.choice) ?? 0) + 1);
    expect([...choices]).toEqual([
      ["Shakespeare", 6],
      ["The 19th-century novel", 7],
      ["Modern texts", 15],
      ["Poetry anthology", 3],
    ]);
  });

/*
   * The list has now been read against the specification and accepted, so the
   * texts are offered. What is still tested is the gate itself: nothing is
   * servable for a specification whose list nobody has checked, which is the
   * case below for one that has no list at all.
   */
  it("offers the texts once a person has checked the list", () => {
    expect(catalogue.verified).toBe(true);
    expect(servableExamSetTexts("8702")).toHaveLength(catalogue.texts.length);
    expect(specificationSetsTexts("8702")).toBe(true);
    expect(matchExamSetText("8702", "Macbeth")?.id).toBe("aqa-8702-macbeth");
    expect(filterCanonicalSetTextIds("8702", ["aqa-8702-macbeth"])).toEqual({
      setTextIds: ["aqa-8702-macbeth"],
      rejected: [],
    });
  });

  it("still refuses an id the checked list does not hold", () => {
    expect(filterCanonicalSetTextIds("8702", ["aqa-8702-hamlet"]).rejected).toEqual([
      "aqa-8702-hamlet",
    ]);
  });

  it("offers nothing for a specification that sets no texts", () => {
    expect(servableExamSetTexts("8300")).toEqual([]);
    expect(specificationSetsTexts("8300")).toBe(false);
  });
});

/**
 * Reading a body of text that was never meant to name one thing, where the
 * first match is not good enough.
 */
describe("reading the set text a question is about", () => {
  const texts = examSetTextCatalogue("8702")!.texts;

  it("takes the one text a question's wording names", () => {
    expect(
      uniqueSetTextIn(texts, "How does Shakespeare present Macbeth as a disturbed character?")?.label
    ).toBe("Macbeth");
  });

  /*
   * The case that matters. A page naming two texts cannot say which question
   * is about which, and filing it under either hides it from half the students
   * who study it.
   */
  it("refuses a passage that names more than one", () => {
    expect(
      uniqueSetTextIn(texts, "Section B: answer on Jane Eyre or on Frankenstein")
    ).toBeUndefined();
  });

  it("refuses a passage that names none", () => {
    expect(uniqueSetTextIn(texts, "Answer one question from this section.")).toBeUndefined();
    expect(uniqueSetTextIn(texts, "")).toBeUndefined();
  });

  it("reads a title printed with its author", () => {
    expect(
      uniqueSetTextIn(texts, "Arthur Conan Doyle: The Sign of Four. Read the extract below.")?.label
    ).toBe("The Sign of Four");
  });
});

describe("reading the set text a question names", () => {
  const texts = examSetTextCatalogue("8702")!.texts;

  it("matches a heading that prints the title alone", () => {
    expect(matchSetTextIn(texts, "Macbeth")?.id).toBe("aqa-8702-macbeth");
  });

  /** AQA prints "Arthur Conan Doyle: The Sign of Four" above the question. */
  it("matches a heading that prints the author beside the title", () => {
    expect(matchSetTextIn(texts, "Arthur Conan Doyle: The Sign of Four")?.label).toBe("The Sign of Four");
    expect(matchSetTextIn(texts, "Robert Louis Stevenson: The Strange Case of Dr Jekyll and Mr Hyde")?.label).toBe(
      "The Strange Case of Dr Jekyll and Mr Hyde"
    );
  });

  it("reads past the punctuation a paper and a specification disagree about", () => {
    expect(matchSetTextIn(texts, "Chinonyerem Odimba: Princess and The Hustler")?.label).toBe("Princess & The Hustler");
  });

  /*
   * A title the specification does not set is not a near miss to be corrected.
   * Storing it would file the question under a text no student can choose,
   * hiding it from everybody rather than showing it to the wrong people.
   */
  it("matches nothing for a text this specification does not set", () => {
    expect(matchSetTextIn(texts, "Hamlet")).toBeUndefined();
    expect(matchSetTextIn(texts, "")).toBeUndefined();
  });
});

describe("whether a question is one this student could sit", () => {
  const question = (setTextId?: string) =>
    ({
      origin: "official_past_paper",
      provenance: {
        board: "aqa",
        qualification: "gcse",
        specificationId: "8702",
        componentCode: "1",
      },
      ...(setTextId ? { setTextId } : {}),
    }) as ExamQuestion;

  const course = (setTextIds?: string[]) =>
    buildExamCourseSelection({
      board: "aqa",
      qualification: "gcse",
      specificationId: "8702",
      specificationTitle: "GCSE English Literature",
      ...(setTextIds ? { setTextIds } : {}),
    });

  it("keeps a question on a text the student studies", () => {
    expect(questionMatchesExamCourse(question("aqa-8702-macbeth"), course(["aqa-8702-macbeth"]))).toBe(true);
  });

  it("refuses a question on a text they do not", () => {
    expect(questionMatchesExamCourse(question("aqa-8702-jane-eyre"), course(["aqa-8702-macbeth"]))).toBe(false);
  });

  /** Unseen poetry sets no text, so it belongs to everyone. */
  it("keeps a question that names no text at all", () => {
    expect(questionMatchesExamCourse(question(), course(["aqa-8702-macbeth"]))).toBe(true);
  });

  /** An empty picker should not empty the paper. */
  it("keeps every question until the student has chosen", () => {
    expect(questionMatchesExamCourse(question("aqa-8702-jane-eyre"), course())).toBe(true);
  });
});
