import { describe, expect, it } from "vitest";
import {
  buildTutorSuggestionInstruction,
  getTutorSuggestionKinds,
  readSavedTutorSuggestions,
  readTutorSuggestions,
  resolveTutorSuggestions,
} from "@/lib/ai/tutor-suggestion";

const both = ["flashcards", "practice"] as const;

describe("readTutorSuggestions", () => {
  it("keeps the known suggestions once each and drops anything else, Explain more included", () => {
    expect(readTutorSuggestions(["practice", "more", "quiz", "practice", 3])).toEqual(["practice"]);
    expect(readTutorSuggestions("flashcards")).toEqual([]);
    expect(readTutorSuggestions(undefined)).toEqual([]);
  });
});

describe("resolveTutorSuggestions", () => {
  it("shows nothing when Tutor suggests nothing, however much it taught", () => {
    expect(
      resolveTutorSuggestions({ suggestions: [], depth: "standard", allowedMaterial: both })
    ).toEqual({ followUps: [], studyMaterialOffers: [] });
  });

  it("shows every suggestion Tutor made that is allowed here", () => {
    expect(
      resolveTutorSuggestions({
        suggestions: ["steps", "flashcards", "practice"],
        depth: "brief",
        allowedMaterial: both,
      })
    ).toEqual({
      followUps: [{ label: "Show steps", prompt: "Show me the steps." }],
      studyMaterialOffers: ["flashcards", "practice"],
    });
  });

  it("never offers material where it is not allowed, such as a hint or a marking", () => {
    expect(
      resolveTutorSuggestions({
        suggestions: ["flashcards", "practice"],
        depth: "brief",
        allowedMaterial: [],
      }).studyMaterialOffers
    ).toEqual([]);
  });

  it("does not offer the steps of an answer that was asked for in full", () => {
    expect(
      resolveTutorSuggestions({ suggestions: ["steps"], depth: "detailed", allowedMaterial: both })
        .followUps
    ).toEqual([]);
  });
});

describe("readSavedTutorSuggestions", () => {
  it("reads what an earlier answer offered from its saved buttons", () => {
    expect(
      readSavedTutorSuggestions({
        followUps: [
          { label: "Explain more", prompt: "Explain that in more detail." },
          { label: "Show steps", prompt: "Show me the steps." },
        ],
        studyMaterialOffers: ["flashcards", "practice"],
      })
    ).toEqual(["steps", "flashcards", "practice"]);
    expect(readSavedTutorSuggestions({})).toEqual([]);
  });
});

describe("buildTutorSuggestionInstruction", () => {
  it("leaves practice out where practice sets are off", () => {
    expect(getTutorSuggestionKinds(false)).toEqual(["steps", "flashcards"]);
    expect(buildTutorSuggestionInstruction({ practiceAvailable: false })).not.toContain('"practice"');
    expect(buildTutorSuggestionInstruction({ practiceAvailable: true })).toContain('"practice"');
  });

  it("tells Tutor what it offered last time instead of forbidding it", () => {
    expect(
      buildTutorSuggestionInstruction({ practiceAvailable: true, previous: ["flashcards", "practice"] })
    ).toContain(
      "already offered flashcards and practice questions; offer the same again only if this answer teaches something new"
    );
    expect(buildTutorSuggestionInstruction({ practiceAvailable: true })).not.toContain("already offered");
  });
});
