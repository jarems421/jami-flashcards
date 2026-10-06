import { describe, expect, it } from "vitest";
import type { Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";
import {
  defaultPaperMaterial,
  describedExamRequest,
  generatedPaperRequestProblem,
  paperMaterialTitle,
  splitPaperMaterial,
} from "@/lib/practice/practice-paper-request";

function source(id: string, title: string): Source {
  return {
    id,
    title,
    type: "file",
    fileName: `${title}.pdf`,
    folderIds: ["folder-1"],
    topicIds: [],
    status: "active",
    createdBy: "student",
    createdAt: 1,
    updatedAt: 1,
  };
}

const ready = {
  folderId: "folder-1",
  hasCourse: false,
  schoolFolder: false,
  moduleName: "Analysis 3",
  topicsRequired: false,
  topicCount: 0,
  sourcesUnconfirmed: false,
  materialCount: 0,
};

describe("a described exam's request", () => {
  it("asks for the exam in its own format when there are no past papers", () => {
    expect(describedExamRequest({ module: "Analysis 3", kind: "midterm", length: "90", withPastPapers: false })).toBe(
      "A complete practice mid-term exam for Analysis 3, 1½ hours, in the format that exam uses."
    );
  });

  it("models the paper on past papers when the student has them, and leaves out an unknown length", () => {
    const request = describedExamRequest({ module: "Analysis 3", kind: "final", length: "unsure", withPastPapers: true });
    expect(request).toMatch(/^A new practice final exam for Analysis 3, modelled closely on my past papers/);
  });
});

describe("paper material", () => {
  const notes = source("notes", "Week 3 lecture");
  const paper = source("paper", "2023 past paper");
  const scheme = source("scheme", "2023 mark scheme");

  it("puts past papers and schemes before notes", () => {
    expect(splitPaperMaterial([notes, paper, scheme])).toEqual({ papers: [paper, scheme], notes: [notes] });
    expect(defaultPaperMaterial([notes, paper, scheme])).toEqual(["paper", "scheme", "notes"]);
  });

  it("starts from no more than one paper can read", () => {
    const many = Array.from({ length: MAX_PRACTICE_PAPER_SOURCE_IDS + 3 }, (_, index) => source(`n${index}`, `Notes ${index}`));
    expect(defaultPaperMaterial(many)).toHaveLength(MAX_PRACTICE_PAPER_SOURCE_IDS);
  });

  it("names an uploaded past paper so it is sorted as one", () => {
    expect(paperMaterialTitle("june-2023.pdf", "paper")).toBe("Past paper: june-2023");
    expect(paperMaterialTitle("2023 exam paper.pdf", "paper")).toBe("2023 exam paper");
    expect(paperMaterialTitle("week 3.pdf", "notes")).toBe("week 3");
  });
});

describe("what a generated paper still needs", () => {
  it("is nothing once everything is chosen", () => {
    expect(generatedPaperRequestProblem(ready)).toBeNull();
  });

  it("asks for the first thing missing, in the order the builder is filled in", () => {
    expect(generatedPaperRequestProblem({ ...ready, folderId: "", moduleName: "" })).toBe("Choose a folder for this paper.");
    expect(generatedPaperRequestProblem({ ...ready, moduleName: " " })).toBe("Add the module this exam is for.");
    expect(generatedPaperRequestProblem({ ...ready, moduleName: "", schoolFolder: true })).toBe(
      "Choose your board and course, or name the course."
    );
    expect(generatedPaperRequestProblem({ ...ready, hasCourse: true, moduleName: "", topicsRequired: true })).toBe(
      "Choose at least one topic for this paper."
    );
    expect(generatedPaperRequestProblem({ ...ready, sourcesUnconfirmed: true })).toBe(
      "Review and confirm the sources Jami proposes for this paper."
    );
    expect(generatedPaperRequestProblem({ ...ready, materialCount: MAX_PRACTICE_PAPER_SOURCE_IDS + 1 })).toBe(
      "That's more material than one paper can use. Untick some and try again."
    );
  });

  it("lets a picked course with topics through once one topic is in", () => {
    expect(generatedPaperRequestProblem({ ...ready, hasCourse: true, topicsRequired: true, topicCount: 1 })).toBeNull();
  });
});
