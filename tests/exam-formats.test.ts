import { describe, expect, it } from "vitest";
import {
  buildPracticePaperBrief,
  findDistinctivePaperOverlap,
  isOfficialExamBoardUrl,
  normalizeExamFormatProfileVersion,
  practicePaperFormatContext,
  practicePaperFormatIssues,
  selectExamFormatVersion,
} from "@/lib/practice/exam-formats";

const hash = "a".repeat(64);

function profile(version = "2026") {
  return normalizeExamFormatProfileVersion({
    version,
    boardLabel: "AQA",
    qualification: "gcse",
    qualificationLabel: "GCSE",
    subject: "Mathematics",
    specificationCode: "8300",
    specificationTitle: "GCSE Mathematics",
    componentCode: "1H",
    componentTitle: "Paper 1 Higher",
    tier: "Higher",
    calculatorPolicy: "not_allowed",
    durationMinutes: 90,
    totalMarks: 80,
    sections: [{ id: "main", title: "Questions", marks: 80 }],
    choiceRules: ["Answer all questions"],
    requiredMaterials: [{ kind: "formula_sheet", title: "Formula sheet", supplied: true }],
    status: "current",
    effectiveFrom: "2026-09-01",
    sources: [
      { id: "spec", title: "Official specification", url: "https://www.aqa.org.uk/spec", documentType: "specification", retrievedAt: 1, documentHash: hash, supports: ["duration"] },
      { id: "paper", title: "Specimen paper", url: "https://filestore.aqa.org.uk/sample.pdf", documentType: "sample_paper", retrievedAt: 1, documentHash: hash, supports: ["marks"] },
    ],
  }, { profileId: "aqa-gcse-mathematics-8300-1h", board: "aqa", now: 10 });
}

describe("exam-format profiles", () => {
  it("accepts only HTTPS URLs from the selected official board", () => {
    expect(isOfficialExamBoardUrl("aqa", "https://filestore.aqa.org.uk/paper.pdf")).toBe(true);
    expect(isOfficialExamBoardUrl("aqa", "http://www.aqa.org.uk/paper.pdf")).toBe(false);
    expect(isOfficialExamBoardUrl("aqa", "https://aqa.org.uk.attacker.example/paper.pdf")).toBe(false);
    expect(isOfficialExamBoardUrl("aqa", "https://www.ocr.org.uk/paper.pdf")).toBe(false);
  });

  it("marks a structurally complete two-source profile as verified", () => {
    const normalized = profile();
    expect(normalized?.verificationStatus).toBe("verified");
    expect(normalized?.confidence).toBe("high");
    expect(buildPracticePaperBrief(normalized!).requiresConfirmation).toBe(false);
  });

  it("keeps incomplete evidence visible as limited", () => {
    const normalized = normalizeExamFormatProfileVersion({
      ...profile(),
      version: "limited",
      sources: [{ id: "spec", title: "Specification", url: "https://www.aqa.org.uk/spec", documentType: "specification", retrievedAt: 1, documentHash: hash, supports: [] }],
    }, { profileId: "limited", board: "aqa", now: 10 });
    expect(normalized?.verificationStatus).toBe("limited");
    expect(normalized?.issues.map((issue) => issue.code)).toContain("missing_assessment_artifact");
  });

  it("selects the version effective on the requested date", () => {
    const oldVersion = { ...profile("2025")!, effectiveFrom: "2025-09-01", effectiveUntil: "2026-08-31" };
    const newVersion = { ...profile("2026")!, effectiveFrom: "2026-09-01", effectiveUntil: undefined };
    expect(selectExamFormatVersion([newVersion, oldVersion], new Date("2026-06-01"))?.version).toBe("2025");
    expect(selectExamFormatVersion([oldVersion, newVersion], new Date("2027-06-01"))?.version).toBe("2026");
  });

  it("detects exact structural mismatches", () => {
    expect(practicePaperFormatIssues({ durationMinutes: 60, totalMarks: 79 }, profile()!)).toEqual([
      "Duration must be 90 minutes.",
      "Total marks must be 80.",
    ]);
  });

  it("blocks distinctive question copying but ignores ordinary boilerplate", () => {
    const distinctive = "A marine biologist records fourteen luminous crabs moving clockwise around a volcanic island before sunrise each morning";
    expect(findDistinctivePaperOverlap([distinctive], [distinctive])).toHaveLength(1);
    expect(findDistinctivePaperOverlap(["Answer all questions and show your working"], ["Answer all questions and show your working"])).toHaveLength(0);
  });
});

/**
 * A profile whose own numbers do not add up cannot be satisfied by any paper,
 * and until now nothing checked. `conflicting_marks` was a declared issue code
 * that nothing ever produced.
 *
 * The researched AQA A-level Psychology profile said each of four topic blocks
 * contributes 24 marks "via one 4-mark outline question and one 16-mark"
 * question. 4 + 16 is 20, so four blocks reach 80 against a stated total of 96.
 * The generator followed the question shapes, produced 80, and the whole-paper
 * audit refused to publish a paper sixteen marks short of its own
 * specification -- every run, for three days, after twenty-eight model calls
 * had already been paid for.
 */
describe("a profile whose marks do not add up", () => {
  const withSections = (totalMarks: number, sectionMarks: (number | undefined)[]) =>
    normalizeExamFormatProfileVersion({
      version: "2026",
      boardLabel: "AQA",
      qualification: "a_level",
      qualificationLabel: "A-level",
      subject: "Psychology",
      specificationCode: "7182",
      specificationTitle: "A-level Psychology",
      componentCode: "1",
      componentTitle: "Paper 1",
      durationMinutes: 120,
      totalMarks,
      sections: sectionMarks.map((marks, index) => ({
        id: `block${index + 1}`,
        title: `Topic block ${index + 1}`,
        ...(marks === undefined ? {} : { marks }),
      })),
      choiceRules: ["Answer all questions"],
      status: "current",
      sources: [
        { id: "spec", title: "Specification", url: "https://www.aqa.org.uk/spec", documentType: "specification", retrievedAt: 1, documentHash: hash, supports: ["duration"] },
        { id: "paper", title: "Specimen", url: "https://filestore.aqa.org.uk/s.pdf", documentType: "sample_paper", retrievedAt: 1, documentHash: hash, supports: ["marks"] },
      ],
    }, { profileId: "aqa-a-level-psychology-7182-1", board: "aqa", now: 10 });

  it("reports the shortfall the audit would have found, before any paper is built", () => {
    // The real defect: four blocks of 20 against a stated 96.
    const normalized = withSections(96, [20, 20, 20, 20]);
    const issue = normalized?.issues.find((entry) => entry.code === "conflicting_marks");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("80");
    expect(issue?.message).toContain("96");
  });

  it("says nothing when the sections reach the stated total", () => {
    const normalized = withSections(96, [24, 24, 24, 24]);
    expect(normalized?.issues.some((entry) => entry.code === "conflicting_marks")).toBe(false);
  });

  /**
   * A profile that describes its structure in prose is unverifiable here, not
   * wrong. Flagging it would make the check noise and get it ignored.
   */
  /**
   * The profile that cost three days. It read verified, high confidence, no
   * issues -- and carried zero sections, no tariff progression and a
   * one-sentence summary naming the wrong fourth topic. Nothing in it was
   * contradictory because there was almost nothing in it, so the generator
   * inferred a structure and the audit refused the result.
   */
  it("refuses a profile with nothing to build a paper against", () => {
    const empty = normalizeExamFormatProfileVersion({
      version: "2026",
      boardLabel: "AQA",
      qualification: "a_level",
      qualificationLabel: "A-level",
      subject: "Psychology",
      specificationCode: "7182",
      specificationTitle: "A-level Psychology",
      componentCode: "1",
      componentTitle: "Paper 1",
      durationMinutes: 120,
      totalMarks: 96,
      sections: [],
      tariffProgression: [],
      status: "current",
      sources: [
        { id: "spec", title: "Specification", url: "https://www.aqa.org.uk/spec", documentType: "specification", retrievedAt: 1, documentHash: hash, supports: ["duration"] },
        { id: "paper", title: "Specimen", url: "https://filestore.aqa.org.uk/s.pdf", documentType: "sample_paper", retrievedAt: 1, documentHash: hash, supports: ["marks"] },
      ],
    }, { profileId: "aqa-a-level-psychology-7182-1", board: "aqa", now: 10 });
    const issue = empty?.issues.find((entry) => entry.code === "conflicting_component");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("nothing to build");
    expect(empty?.verificationStatus).not.toBe("verified");
  });

  /** A tariff progression is structure too, even without section marks. */
  it("accepts a profile that describes its tariffs instead of its sections", () => {
    const described = normalizeExamFormatProfileVersion({
      version: "2026",
      boardLabel: "AQA",
      qualification: "a_level",
      qualificationLabel: "A-level",
      subject: "Psychology",
      specificationCode: "7182",
      specificationTitle: "A-level Psychology",
      componentCode: "1",
      componentTitle: "Paper 1",
      durationMinutes: 120,
      totalMarks: 96,
      sections: [],
      tariffProgression: ["Each of four sections totals 24 marks: short answers then a 16-mark essay."],
      status: "current",
      sources: [
        { id: "spec", title: "Specification", url: "https://www.aqa.org.uk/spec", documentType: "specification", retrievedAt: 1, documentHash: hash, supports: ["duration"] },
        { id: "paper", title: "Specimen", url: "https://filestore.aqa.org.uk/s.pdf", documentType: "sample_paper", retrievedAt: 1, documentHash: hash, supports: ["marks"] },
      ],
    }, { profileId: "aqa-a-level-psychology-7182-1", board: "aqa", now: 10 });
    expect(described?.issues.some((entry) => entry.code === "conflicting_component")).toBe(false);
  });

  it("declines to judge a profile that does not state section marks", () => {
    expect(
      withSections(96, [undefined, undefined])?.issues.some((entry) => entry.code === "conflicting_marks")
    ).toBe(false);
    expect(
      withSections(96, [24, undefined])?.issues.some((entry) => entry.code === "conflicting_marks")
    ).toBe(false);
  });
});

/**
 * What the designer is actually told about the sections.
 *
 * This string is the whole constraint. When it listed section titles and marks
 * but not the ids the check compares against, ten drafts of one 96-mark
 * component came back at 80 to 178 marks, and the first to use sections at all
 * split them 43/41/41/43 against a required 24. When it named the marks but not
 * the question counts, the closest draft was 25/26/27/26.
 */
describe("the sections as the designer reads them", () => {
  const profile = {
    profileId: "aqa-a-level-psychology-7182-1",
    version: "2026-verified-from-jun22",
    boardLabel: "AQA",
    qualificationLabel: "A-level",
    subject: "Psychology",
    specificationTitle: "A-level Psychology",
    specificationCode: "7182",
    componentTitle: "Paper 1",
    componentCode: "7182/1",
    durationMinutes: 120,
    totalMarks: 96,
    sections: [
      { id: "A", title: "Social influence", marks: 24, requiredQuestions: 4 },
      { id: "D", title: "Approaches", marks: 24, requiredQuestions: 6 },
    ],
    choiceRules: [],
    requiredMaterials: [],
    assessmentObjectives: [],
  } as never;

  it("binds each section's id, marks and question count together", () => {
    expect(practicePaperFormatContext(profile)).toContain(
      "A (Social influence), 24 marks across exactly 4 questions"
    );
  });

  /** Section D carries a different count, so the figure has to travel per section. */
  it("does not reuse one section's count for another", () => {
    expect(practicePaperFormatContext(profile)).toContain(
      "D (Approaches), 24 marks across exactly 6 questions"
    );
  });

  /** Plenty of profiles list sections without a per-section breakdown. */
  /**
   * The strongest constraint the profile holds. "A 3+1+4+16" fixes the question
   * count, the per-question marks and the section total in one line, and it sat
   * unsent through every draft that came back at 121 to 178 marks.
   */
  it("passes on the tariff pattern the profile observed", () => {
    const withTariffs = {
      ...(profile as Record<string, unknown>),
      tariffProgression: ["Observed June 2022 tariffs: A 3+1+4+16, B 2+2+4+16."],
    } as never;
    expect(practicePaperFormatContext(withTariffs)).toContain("A 3+1+4+16");
  });

  it("names the command words the component uses", () => {
    const withWords = {
      ...(profile as Record<string, unknown>),
      commandWords: ["Outline", "Discuss"],
    } as never;
    expect(practicePaperFormatContext(withWords)).toContain("Outline, Discuss");
  });

  it("says only what the profile knows", () => {
    const sparse = {
      ...(profile as Record<string, unknown>),
      sections: [{ id: "A", title: "Social influence" }],
    } as never;
    const context = practicePaperFormatContext(sparse);
    expect(context).toContain("A (Social influence)");
    expect(context).not.toContain("marks across exactly");
    expect(context).not.toContain("Tariff pattern:");
    expect(context).not.toContain("Command words");
  });
});
