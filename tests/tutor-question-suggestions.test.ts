import { describe, expect, it } from "vitest";
import {
  invitesTutorQuestionSuggestions,
  normalizeSuggestedQuestions,
  practiceQuestionDraftFields,
  readTutorQuestionSuggestions,
} from "@/lib/ai/tutor-question-suggestions";
import { buildAssistantResponseSchema } from "@/app/api/ai/assistant/response-schema";

/**
 * Practice questions Tutor suggests: offered only when asked for, kept only
 * when markable, and saved as a draft with the scheme beside the answer.
 */

const question = {
  prompt: "Explain why the rate of photosynthesis levels off at high light intensity.",
  marks: 3,
  answer: "Another factor, such as carbon dioxide concentration or temperature, becomes limiting.",
  points: [
    { marks: 1, text: "Rate stops increasing with light" },
    { marks: 1, text: "Another factor becomes limiting" },
    { marks: 1, text: "Names carbon dioxide or temperature" },
  ],
  sourceRef: "S1",
};

describe("when questions are offered", () => {
  it("offers them when the student asks to be set questions", () => {
    for (const message of [
      "Give me some practice questions on this",
      "write exam-style questions about osmosis",
      "Can you test me on this?",
      "quiz me",
      "Set me 3 questions",
    ]) {
      expect(invitesTutorQuestionSuggestions({ message, readableSourceCount: 1 }), message).toBe(true);
    }
  });

  it("does not answer a student's own question with a worksheet", () => {
    for (const message of [
      "I have a question about osmosis",
      "What does this question mean?",
      "Can you answer my questions about enzymes?",
    ]) {
      expect(invitesTutorQuestionSuggestions({ message, readableSourceCount: 1 }), message).toBe(false);
    }
  });

  it("needs a source to save them against", () => {
    expect(invitesTutorQuestionSuggestions({ message: "quiz me", readableSourceCount: 0 })).toBe(false);
  });

  it("asks the model for them only on a turn that invited them", () => {
    expect(buildAssistantResponseSchema(["S1"], false, false, true).properties).toHaveProperty("questions");
    expect(buildAssistantResponseSchema(["S1"], false, false, false).properties).not.toHaveProperty("questions");
    expect(buildAssistantResponseSchema([], false, false, true).properties).not.toHaveProperty("questions");
  });
});

describe("which questions are kept", () => {
  const read = (value: unknown, evidence?: string[]) =>
    readTutorQuestionSuggestions(value, {
      allowedSourceRefs: ["S1"],
      ...(evidence ? { evidenceBySourceRef: new Map([["S1", evidence]]) } : {}),
    });

  it("keeps a markable question", () => {
    expect(read([question])).toEqual([question]);
  });

  it("drops a question whose scheme does not add up to its marks", () => {
    expect(read([{ ...question, marks: 4 }])).toEqual([]);
  });

  it("drops one citing a source this turn never read, and duplicates", () => {
    expect(read([{ ...question, sourceRef: "S9" }])).toEqual([]);
    expect(read([question, { ...question, prompt: question.prompt.toUpperCase() }])).toHaveLength(1);
  });

  it("drops a question lifted from its source", () => {
    const lifted = "the rate of photosynthesis levels off at high light intensity because another factor becomes limiting";
    expect(read([{ ...question, prompt: `Explain why ${lifted}.` }], [`In the notes: ${lifted} in most plants.`])).toEqual([]);
  });

  it("reads saved questions back, refusing a broken scheme", () => {
    const saved = { ...question, sourceId: "source-1", sourceTitle: "Plant notes", topicIds: ["topic-1"] };
    expect(normalizeSuggestedQuestions([saved])).toHaveLength(1);
    expect(normalizeSuggestedQuestions([{ ...saved, marks: 2 }])).toEqual([]);
  });
});

describe("saved as a draft", () => {
  it("prints the tariff with the question and the scheme beside the answer", () => {
    const fields = practiceQuestionDraftFields(question);
    expect(fields.questionText).toBe(`${question.prompt} [3 marks]`);
    expect(fields.answerText).toBe(question.answer);
    expect(fields.solutionText).toContain("Mark scheme (3 marks):");
    expect(fields.solutionText).toContain("- Another factor becomes limiting (1 mark)");
  });
});
