import { describe, expect, it } from "vitest";
import { examExemplarFromGroup, jamiShareOfMix, MAX_MODELLED_MARKS } from "@/lib/practice/exam-exemplars";
import type { ExamQuestion } from "@/lib/practice/exam-questions";

const rights = {
  key: "aqa-2026", version: 1, verified: true, storageAllowed: true,
  studentDisplayAllowed: true, aiInferenceAllowed: true, revoked: false,
};

function part(id: string, prompt: string, marks: number, overrides: Partial<ExamQuestion> = {}) {
  return {
    id, prompt, marks, label: id, origin: "official_past_paper", rights, difficulty: "medium",
    provenance: { questionNumber: id },
    ...overrides,
  } as unknown as ExamQuestion;
}

describe("Jami's share of a session", () => {
  it("is about a third, at least one from two questions, taken from the largest difficulties", () => {
    expect(jamiShareOfMix({ easy: 1, medium: 0, hard: 0 })).toEqual({ easy: 0, medium: 0, hard: 0 });
    expect(jamiShareOfMix({ easy: 1, medium: 1, hard: 0 })).toEqual({ easy: 0, medium: 1, hard: 0 });
    expect(jamiShareOfMix({ easy: 3, medium: 4, hard: 2 })).toEqual({ easy: 1, medium: 2, hard: 0 });
    const share = jamiShareOfMix({ easy: 0, medium: 0, hard: 6 });
    expect(share).toEqual({ easy: 0, medium: 0, hard: 2 });
  });
});

describe("modelling a question on a real one", () => {
  it("keeps each part's text and tariff and the whole question's marks", () => {
    const exemplar = examExemplarFromGroup({
      key: "p:5",
      difficulty: "medium",
      parts: [part("5(a)", "State the unit of force.", 1), part("5(b)", "Calculate the weight of a 2 kg mass.", 3)],
    });
    expect(exemplar).toEqual({
      text: "5(a): State the unit of force. [1 mark]\n\n5(b): Calculate the weight of a 2 kg mass. [3 marks]",
      marks: 4,
      difficulty: "medium",
    });
  });

  it("caps the tariff at what one answer can carry", () => {
    expect(examExemplarFromGroup({ key: "k", difficulty: "hard", parts: [part("7", "Evaluate…", 30)] })?.marks).toBe(MAX_MODELLED_MARKS);
  });

  it("never uses a question whose rights do not allow sending it to an AI provider, or one Jami wrote", () => {
    expect(
      examExemplarFromGroup({ key: "k", difficulty: "medium", parts: [part("1", "Q", 2, { rights: { ...rights, aiInferenceAllowed: false } })] })
    ).toBeNull();
    expect(
      examExemplarFromGroup({ key: "k", difficulty: "medium", parts: [part("1", "Q", 2, { origin: "jami_generated" })] })
    ).toBeNull();
  });
});
