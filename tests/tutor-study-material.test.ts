import { describe, expect, it } from "vitest";
import {
  buildTutorStudyMaterialInstruction,
  detectTutorStudyMaterialRequest,
  getTutorStudyMaterialOffers,
  normalizeTutorStudyMaterialRequest,
  normalizeTutorStudyMaterialResult,
  normalizeTutorStudyMaterialResults,
  readTutorStudyMaterialCount,
  resolveTutorStudyMaterialRequest,
} from "@/lib/ai/tutor-study-material";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";

const sources: JamiAssistantContext = { surface: "sources", sourceIds: ["source-1"] };
const teachingAnswer =
  "When you separate variables, you want every y term with dy and every x term with dx. ".repeat(5);

describe("detectTutorStudyMaterialRequest", () => {
  it.each([
    "hey, can you please make me flashcards on this topic?",
    "Make flashcards on differential equations",
    "could you create some flashcards from this",
    "I want flashcards for this please",
    "give me 10 flash cards on enzymes",
    "turn this into revision cards",
  ])("reads %j as a flashcard request", (message) => {
    expect(detectTutorStudyMaterialRequest(message)).toBe("flashcards");
  });

  it.each([
    "can you make me practice questions on this",
    "give me some exam style questions on integration by parts",
    "make a practice set on separating variables",
    "Could you write 5 practise questions for me",
    "I need some questions to practise on this",
  ])("reads %j as a practice request", (message) => {
    expect(detectTutorStudyMaterialRequest(message)).toBe("practice");
  });

  it.each([
    "what are flashcards good for?",
    "can you help me with differential equations?",
    "quiz me on this",
    "ask me some questions on this",
    "don't make flashcards, just explain it again",
    "",
  ])("leaves %j alone", (message) => {
    expect(detectTutorStudyMaterialRequest(message)).toBeNull();
  });

  it("takes whichever was asked for first when both are named", () => {
    expect(
      detectTutorStudyMaterialRequest("make flashcards and then some practice questions on this")
    ).toBe("flashcards");
  });
});

describe("readTutorStudyMaterialCount", () => {
  it("reads a number the student gave, within bounds", () => {
    expect(readTutorStudyMaterialCount("make me 10 flashcards", "flashcards")).toBe(10);
    expect(readTutorStudyMaterialCount("give me five practice questions", "practice")).toBe(5);
    expect(readTutorStudyMaterialCount("make 50 flashcards", "flashcards")).toBe(15);
    expect(readTutorStudyMaterialCount("make 40 exam questions", "practice")).toBe(10);
  });

  it("falls back to the default when none was said", () => {
    expect(readTutorStudyMaterialCount("make me flashcards", "flashcards")).toBe(6);
    expect(readTutorStudyMaterialCount("practice questions please", "practice")).toBe(5);
  });
});

describe("getTutorStudyMaterialOffers", () => {
  it("offers flashcards and practice after teaching", () => {
    expect(
      getTutorStudyMaterialOffers({
        message: "I'm struggling with when to divide x over in separable equations",
        answer: teachingAnswer,
        context: sources,
        practiceAvailable: true,
      })
    ).toEqual(["flashcards", "practice"]);
  });

  it("does not offer what is already being made, or practice where it does not exist", () => {
    expect(
      getTutorStudyMaterialOffers({
        message: "explain this",
        answer: teachingAnswer,
        context: sources,
        practiceAvailable: false,
        requested: "flashcards",
      })
    ).toEqual([]);
    expect(
      getTutorStudyMaterialOffers({
        message: "make me flashcards",
        answer: teachingAnswer,
        context: sources,
        practiceAvailable: true,
        requested: "flashcards",
      })
    ).toEqual(["practice"]);
  });

  it("offers nothing after a short answer, marking, or on an unflipped card", () => {
    expect(
      getTutorStudyMaterialOffers({
        message: "explain",
        answer: "It is 4.",
        context: sources,
        practiceAvailable: true,
      })
    ).toEqual([]);
    expect(
      getTutorStudyMaterialOffers({
        message: "mark my work",
        answer: teachingAnswer,
        context: { surface: "notebook", notebookId: "n", pageId: "p" },
        practiceAvailable: true,
      })
    ).toEqual([]);
    expect(
      getTutorStudyMaterialOffers({
        message: "give me a hint, why is this?",
        answer: teachingAnswer,
        context: { surface: "learn", cardId: "c", phase: "question" },
        practiceAvailable: true,
      })
    ).toEqual([]);
  });
});

describe("resolveTutorStudyMaterialRequest", () => {
  it("keeps the student's reading and prefers Tutor's focus", () => {
    expect(
      resolveTutorStudyMaterialRequest({
        detected: "flashcards",
        modelKind: null,
        modelFocus: "separating variables: which side to divide",
        message: "make me 8 flashcards on this",
        practiceAvailable: true,
      })
    ).toEqual({ kind: "flashcards", focus: "separating variables: which side to divide", count: 8 });
  });

  it("accepts Tutor's reading of a wording the pattern missed", () => {
    expect(
      resolveTutorStudyMaterialRequest({
        detected: null,
        modelKind: "practice",
        modelFocus: "integration by parts",
        message: "sort me out with something to test myself on",
        practiceAvailable: true,
      })
    ).toMatchObject({ kind: "practice", focus: "integration by parts" });
  });

  it("refuses practice where it is unavailable, and nothing asked for", () => {
    expect(
      resolveTutorStudyMaterialRequest({
        detected: "practice",
        modelKind: "practice",
        modelFocus: "x",
        message: "practice questions please",
        practiceAvailable: false,
      })
    ).toBeNull();
    expect(
      resolveTutorStudyMaterialRequest({
        detected: null,
        modelKind: null,
        modelFocus: "x",
        message: "thanks",
        practiceAvailable: true,
      })
    ).toBeNull();
  });
});

describe("normalizers", () => {
  it("reads stored requests and results defensively", () => {
    expect(normalizeTutorStudyMaterialRequest({ kind: "flashcards", focus: "  enzymes " })).toEqual({
      kind: "flashcards",
      focus: "enzymes",
    });
    expect(normalizeTutorStudyMaterialRequest({ kind: "essay", focus: "x" })).toBeUndefined();
    expect(
      normalizeTutorStudyMaterialResult({ kind: "flashcards", draftIds: ["a", "a", "b"], focus: "f", createdAt: 5 })
    ).toEqual({ kind: "flashcards", draftIds: ["a", "b"], focus: "f", createdAt: 5 });
    expect(normalizeTutorStudyMaterialResult({ kind: "flashcards", draftIds: [] })).toBeUndefined();
    expect(
      normalizeTutorStudyMaterialResults({
        practice: { kind: "practice", sessionId: "s1", title: "T", focus: "f", questionCount: 5, totalMarks: 18 },
        flashcards: { kind: "practice", sessionId: "wrong-slot" },
      })
    ).toEqual({
      practice: {
        kind: "practice",
        sessionId: "s1",
        title: "T",
        focus: "f",
        questionCount: 5,
        totalMarks: 18,
        createdAt: 0,
      },
    });
  });
});

describe("buildTutorStudyMaterialInstruction", () => {
  it("tells Tutor it can make material and must not redirect", () => {
    const instruction = buildTutorStudyMaterialInstruction({ requested: null, practiceAvailable: true });
    expect(instruction).toMatch(/Never tell the student you cannot make flashcards or practice questions/);
    expect(instruction).toMatch(/never send them to Sources/);
    expect(
      buildTutorStudyMaterialInstruction({ requested: "practice", practiceAvailable: true })
    ).toMatch(/Set studyMaterial to "practice"/);
  });
});
