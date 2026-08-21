import { describe, expect, it } from "vitest";
import {
  buildPracticePaperBrief,
  findDistinctivePaperOverlap,
  isOfficialExamBoardUrl,
  normalizeExamFormatProfileVersion,
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
