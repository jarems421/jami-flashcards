import { describe, expect, it } from "vitest";
import { buildMultipleChoiceQuestion, MCQ_OPTION_COUNT } from "@/lib/study/mcq";
import {
  getStudyAssetCacheKey,
  parseStudyAssetResponse,
  validateStudyAsset,
} from "@/lib/ai/study-assets";
import { buildAiProviderPlan, resolveAiProviderPolicy } from "@/lib/ai/provider-policy";
import {
  ACTIVE_STUDY_SESSION_VERSION,
  normalizeModePolicy,
  normalizeModeResults,
  normalizePersistedExercises,
  normalizePersistedStudySession,
} from "@/lib/study/session";
import type { Card } from "@/lib/study/cards";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "Which organelle makes ATP?",
    back: "The mitochondrion",
    createdAt: 1,
    tags: [],
    ...overrides,
  };
}

const PREPARED = ["The ribosome", "The nucleus", "The lysosome"];

function prepared(distractors: string[] = PREPARED) {
  return card({ studySettings: { mcqDistractors: distractors } });
}

describe("building a multiple-choice question", () => {
  it("produces one correct answer among four", () => {
    const question = buildMultipleChoiceQuestion({ card: prepared(), seed: 7 });
    expect(question).not.toBeNull();
    expect(question!.options).toHaveLength(MCQ_OPTION_COUNT);
    const correct = question!.options.filter(
      (option) => option.id === question!.correctOptionId
    );
    expect(correct).toHaveLength(1);
    expect(correct[0].text).toBe("The mitochondrion");
  });

  it("never repeats an option", () => {
    const question = buildMultipleChoiceQuestion({
      card: prepared([...PREPARED, "The nucleus", "The golgi body"]),
      seed: 3,
    });
    const texts = question!.options.map((option) => option.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("never offers the right answer twice under another name", () => {
    const question = buildMultipleChoiceQuestion({
      card: prepared(["the mitochondrion.", ...PREPARED]),
      seed: 1,
    });
    const matches = question!.options.filter((option) =>
      option.text.toLowerCase().startsWith("the mitochondrion")
    );
    expect(matches).toHaveLength(1);
  });

  it("refuses a card whose wrong answers were never written", () => {
    expect(buildMultipleChoiceQuestion({ card: card(), seed: 1 })).toBeNull();
  });

  it("refuses rather than padding a short list out", () => {
    expect(
      buildMultipleChoiceQuestion({ card: prepared(["The ribosome"]), seed: 1 })
    ).toBeNull();
  });

  /*
   * The one case that needs no preparation. Moving a number by a factor of ten
   * or a tenth lands on the mistakes students actually make, which is more than
   * could ever be said for the answers to neighbouring cards.
   */
  it("builds believable wrong numbers for a numeric answer", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({ back: "9.8 m/s" }),
      seed: 4,
    });
    expect(question).not.toBeNull();
    expect(question!.options).toHaveLength(MCQ_OPTION_COUNT);
    expect(question!.options.every((option) => /\d/.test(option.text))).toBe(true);
  });

  it("uses the author's own distractors", () => {
    const question = buildMultipleChoiceQuestion({ card: prepared(), seed: 2 });
    const texts = question!.options.map((option) => option.text);
    for (const distractor of PREPARED) expect(texts).toContain(distractor);
  });

  it("explains a wrong option with the misconception written for it", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        studySettings: {
          mcqDistractors: PREPARED,
          mcqExplanations: {
            "The ribosome": "Ribosomes build proteins; they do not release energy.",
          },
        },
      }),
      seed: 5,
    });
    const option = question!.options.find(
      (entry) => entry.text === "The ribosome"
    )!;
    expect(question!.explanations[option.id]).toBe(
      "Ribosomes build proteins; they do not release energy."
    );
  });

  it("orders the options the same way for the same seed", () => {
    const input = { card: prepared(), seed: 11 };
    expect(buildMultipleChoiceQuestion(input)).toEqual(
      buildMultipleChoiceQuestion(input)
    );
  });
});

describe("validating a generated asset", () => {
  const subject = { id: "card-1", back: "The mitochondrion is the powerhouse" };

  it("drops a cloze candidate that is not in the answer", () => {
    const asset = validateStudyAsset(
      {
        cardId: "card-1",
        answerShape: "short",
        clozeCandidates: ["mitochondrion", "chloroplast"],
        distractors: ["The ribosome"],
        confidence: 0.9,
        ambiguous: false,
      },
      subject
    );
    expect(asset?.clozeCandidates).toEqual(["mitochondrion"]);
  });

  it("drops a distractor that is the answer", () => {
    const asset = validateStudyAsset(
      {
        cardId: "card-1",
        distractors: ["The mitochondrion is the powerhouse", "The ribosome"],
        confidence: 0.9,
      },
      subject
    );
    expect(asset?.distractors).toEqual(["The ribosome"]);
  });

  it("refuses a low-confidence asset rather than using it weakly", () => {
    expect(
      validateStudyAsset({ cardId: "card-1", confidence: 0.2 }, subject)
    ).toBeNull();
  });

  it("refuses anything the model flagged as ambiguous", () => {
    expect(
      validateStudyAsset(
        { cardId: "card-1", confidence: 0.99, ambiguous: true },
        subject
      )
    ).toBeNull();
  });

  it("refuses an entry claiming to be a different card", () => {
    expect(
      validateStudyAsset({ cardId: "card-2", confidence: 0.9 }, subject)
    ).toBeNull();
  });

  it("survives a fenced response and ignores unknown cards", () => {
    const assets = parseStudyAssetResponse(
      '```json\n{"assets":[{"cardId":"card-1","confidence":0.9,"distractors":["x"]},{"cardId":"ghost","confidence":0.9}]}\n```',
      [subject]
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].cardId).toBe("card-1");
  });

  it("returns nothing for output that is not JSON at all", () => {
    expect(parseStudyAssetResponse("I am sorry, I cannot.", [subject])).toEqual([]);
  });
});

describe("the asset cache key", () => {
  const base = { front: "Q", back: "A" };

  it("is stable for the same card", () => {
    expect(getStudyAssetCacheKey(base)).toBe(getStudyAssetCacheKey(base));
  });

  it("changes when the answer changes", () => {
    expect(getStudyAssetCacheKey(base)).not.toBe(
      getStudyAssetCacheKey({ ...base, back: "A different answer" })
    );
  });

  it("changes when the author's settings change", () => {
    expect(getStudyAssetCacheKey(base)).not.toBe(
      getStudyAssetCacheKey({ ...base, studySettings: { requireUnits: true } })
    );
  });
});

describe("provider escalation", () => {
  // An API key alone does not make a provider ready: the privacy and quality
  // gates have to be approved too.
  const policy = resolveAiProviderPolicy({
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_ENABLED: "true",
    OPENROUTER_PRIVACY_APPROVED: "true",
    OPENROUTER_QUALITY_GATE_PASSED: "true",
  } as unknown as NodeJS.ProcessEnv);

  it("lets an ordinary worker call end on the supervisor", () => {
    const plan = buildAiProviderPlan({
      role: "worker",
      hasVisualInput: false,
      policy,
    });
    expect(plan.some((attempt) => attempt.role === "supervisor")).toBe(true);
  });

  it("keeps a bulk call on the worker when escalation is refused", () => {
    const plan = buildAiProviderPlan({
      role: "worker",
      hasVisualInput: false,
      policy,
      allowRoleEscalation: false,
    });
    expect(plan.some((attempt) => attempt.role === "supervisor")).toBe(false);
    expect(plan.length).toBeGreaterThan(0);
  });
});

describe("session version 3", () => {
  const base = {
    version: ACTIVE_STUDY_SESSION_VERSION,
    sessionId: "session-1",
    revision: 2,
    userId: "user-1",
    studyDayKey: "2026-09-04",
    kind: "daily-required",
    status: "active",
    cardIds: ["card-1", "card-2"],
    index: 0,
    stats: {
      reviewedCards: 0,
      correctAnswers: 0,
      completedGoals: 0,
      starsEarned: 0,
      ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    },
    selectedDeckIds: [],
    selectedTopicIds: [],
    startedAt: 1,
    savedAt: 1,
  };

  it("still reads a v1 and a v2 session", () => {
    for (const version of [1, 2]) {
      const session = normalizePersistedStudySession(
        { ...base, version },
        "user-1",
        "2026-09-04",
        1
      );
      expect(session?.version).toBe(ACTIVE_STUDY_SESSION_VERSION);
      // An older session predates modes and was all Classic. Reading it back as
      // Smart Mix would change what a resumed session asks.
      expect(session?.modePolicy).toBeUndefined();
    }
  });

  it("keeps a v3 session's mode policy and exercises", () => {
    const session = normalizePersistedStudySession(
      {
        ...base,
        modePolicy: { kind: "fixed", mode: "gap-fill" },
        seed: 42,
        exercises: [
          {
            cardId: "card-1",
            mode: "gap-fill",
            contentHash: "abc123",
            cloze: { start: 4, end: 9, answer: "hello" },
          },
        ],
        modeResults: { "gap-fill": { answered: 3, correct: 2 } },
      },
      "user-1",
      "2026-09-04",
      1
    );
    expect(session?.modePolicy).toEqual({ kind: "fixed", mode: "gap-fill" });
    expect(session?.seed).toBe(42);
    expect(session?.exercises).toHaveLength(1);
    expect(session?.modeResults?.["gap-fill"]).toEqual({ answered: 3, correct: 2 });
  });

  it("drops an exercise for a card that is not in the session", () => {
    expect(
      normalizePersistedExercises(
        [{ cardId: "ghost", mode: "classic", contentHash: "abc" }],
        ["card-1"]
      )
    ).toEqual([]);
  });

  it("drops a gap-fill exercise that lost its blank", () => {
    expect(
      normalizePersistedExercises(
        [{ cardId: "card-1", mode: "gap-fill", contentHash: "abc" }],
        ["card-1"]
      )
    ).toEqual([]);
  });

  it("drops a multiple-choice snapshot whose right answer is missing", () => {
    expect(
      normalizePersistedExercises(
        [
          {
            cardId: "card-1",
            mode: "multiple-choice",
            contentHash: "abc",
            mcq: {
              options: [
                { id: "a", text: "One" },
                { id: "b", text: "Two" },
              ],
              correctOptionId: "missing",
            },
          },
        ],
        ["card-1"]
      )
    ).toEqual([]);
  });

  it("falls back to Smart Mix for a policy it does not recognise", () => {
    expect(normalizeModePolicy({ kind: "fixed", mode: "telepathy" })).toEqual({
      kind: "smart",
    });
    expect(normalizeModePolicy(null)).toEqual({ kind: "smart" });
  });

  it("ignores results for a mode that does not exist", () => {
    expect(
      normalizeModeResults({ telepathy: { answered: 1, correct: 1 } })
    ).toEqual({});
  });
});
