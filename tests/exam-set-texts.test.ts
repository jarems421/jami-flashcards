import { describe, expect, it } from "vitest";
import {
  examSetTextCatalogue,
  filterCanonicalSetTextIds,
  matchExamSetText,
  matchSetTextIn,
  servableExamSetTexts,
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

  it("offers nothing until a person has checked the list", () => {
    expect(catalogue.verified).toBe(false);
    expect(servableExamSetTexts("8702")).toEqual([]);
    expect(specificationSetsTexts("8702")).toBe(false);
    expect(matchExamSetText("8702", "Macbeth")).toBeUndefined();
    expect(filterCanonicalSetTextIds("8702", ["aqa-8702-macbeth"]).rejected).toEqual(["aqa-8702-macbeth"]);
  });

  it("offers nothing for a specification that sets no texts", () => {
    expect(servableExamSetTexts("8300")).toEqual([]);
    expect(specificationSetsTexts("8300")).toBe(false);
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
