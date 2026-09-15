import { describe, expect, it } from "vitest";
import type { FlashcardReviewEvent } from "@/lib/learning/events/flashcard-review-event";
import {
  buildLearnerProfile,
  type LearnerEvidence,
} from "@/lib/learning/profile/build-learner-profile";
import type { FlashcardEvidenceCard } from "@/lib/learning/profile/flashcard-signals";
import type { PastPaperEvidenceAttempt } from "@/lib/learning/profile/past-paper-signals";
import type { PracticePaperEvidenceAttempt } from "@/lib/learning/profile/practice-signals";
import { learnerProfileTelemetry } from "@/lib/learning/telemetry";
import type { LearnerProfile, LearningConcept } from "@/lib/learning/types";
import { getStudyDayKey } from "@/lib/study/day";

/**
 * Existing work in, one learner profile out.
 *
 * Every case here is a claim Jami might make to a student, and each test is
 * about when it is allowed to make it: not a weakness from one wrong answer or
 * one question retried, not a trend from one card, not a recurring error from
 * wording that says nothing about how the mark was lost, and never "weak" for
 * a topic nobody has tested.
 */

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 24 * 60 * 60 * 1000;

const LABELS: LearnerEvidence["topicLabels"] = {
  "topic:eigen": { label: "Eigenvectors", source: "student-topic" },
  "topic:matrix": { label: "Matrix multiplication", source: "student-topic" },
  "topic:vectors": { label: "Vector spaces", source: "student-topic" },
  "spec:graphs": { label: "Algebra: graphs", source: "specification" },
};

function card(id: string, overrides: Partial<FlashcardEvidenceCard> = {}): FlashcardEvidenceCard {
  return {
    id,
    deckId: "deck-1",
    topicIds: ["eigen"],
    reps: 6,
    lapses: 0,
    difficulty: 3,
    fsrsState: 2,
    lastReview: NOW - DAY,
    ...overrides,
  };
}

const weakCard = (id: string, overrides: Partial<FlashcardEvidenceCard> = {}) =>
  card(id, { lapses: 4, difficulty: 8, ...overrides });
const strongCard = (id: string, overrides: Partial<FlashcardEvidenceCard> = {}) =>
  card(id, { topicIds: ["matrix"], difficulty: 2, ...overrides });

function reviewEvent(
  id: string,
  cardId: string,
  reviewedAt: number,
  correct: boolean,
  rating?: FlashcardReviewEvent["rating"]
): FlashcardReviewEvent {
  return {
    id,
    cardId,
    deckId: "deck-1",
    reviewedAt,
    studyDayKey: getStudyDayKey(reviewedAt),
    correct,
    ...(rating ? { rating } : {}),
  };
}

type Criterion = {
  criterion: string;
  awarded: boolean;
  awardedMarks?: number;
  maxMarks?: number;
  schemeValue?: string;
  candidateValue?: string;
};

function examAttempt(input: {
  id: string;
  questionId?: string;
  topicIds?: string[];
  awarded: number;
  max: number;
  at: number;
  attemptNumber?: number;
  criteria?: Criterion[];
  improvements?: string[];
}): PastPaperEvidenceAttempt {
  return {
    id: input.id,
    questionId: input.questionId ?? input.id,
    attemptNumber: input.attemptNumber ?? 1,
    markedAt: input.at,
    updatedAt: input.at,
    topicIds: input.topicIds ?? [],
    result: {
      attempted: true,
      awardedMarks: input.awarded,
      maxMarks: input.max,
      criterionResults: input.criteria ?? [],
      improvements: input.improvements ?? [],
    },
  };
}

function practiceAttempt(input: {
  id: string;
  at: number;
  assisted?: boolean;
  scores: Array<[number, number]>;
}): PracticePaperEvidenceAttempt {
  return {
    id: input.id,
    paperId: "paper-1",
    assisted: input.assisted ?? false,
    markedAt: input.at,
    updatedAt: input.at,
    questionResults: input.scores.map(([awardedMarks, maxMarks], index) => ({
      questionId: `${input.id}-q${index + 1}`,
      attempted: true,
      counted: true,
      awardedMarks,
      maxMarks,
      criterionResults: [],
      improvements: [],
    })),
  };
}

function profileOf(evidence: Partial<LearnerEvidence>) {
  return buildLearnerProfile({
    scope: { folderId: "folder-1" },
    now: NOW,
    evidence: {
      cards: [],
      flashcardReviewEvents: [],
      pastPaperAttempts: [],
      practicePaperAttempts: [],
      topicLabels: LABELS,
      ...evidence,
    },
  });
}

function signalFor(profile: LearnerProfile, topic: string) {
  return [...profile.weaknesses, ...profile.strengths, ...profile.uncertain, ...profile.improving].find(
    (signal) => signal.topic === topic
  );
}

describe("topic signals", () => {
  it("does not call a topic weak on one wrong answer, but marks it worth checking", () => {
    const profile = profileOf({
      pastPaperAttempts: [
        examAttempt({ id: "q1", topicIds: ["graphs"], awarded: 0, max: 4, at: NOW - DAY }),
      ],
    });
    expect(profile.weaknesses).toEqual([]);
    expect(profile.uncertain.map((signal) => signal.topic)).toEqual(["Algebra: graphs"]);
    expect(profile.recommendedFocus[0]).toMatchObject({ reason: "low_confidence", action: "diagnose" });
  });

  it("does not call a topic strong on one perfect answer", () => {
    const profile = profileOf({
      pastPaperAttempts: [
        examAttempt({ id: "q1", topicIds: ["graphs"], awarded: 4, max: 4, at: NOW - DAY }),
      ],
    });
    expect(profile.strengths).toEqual([]);
    expect(profile.uncertain).toEqual([]);
  });

  it("names a well-evidenced weakness and a well-evidenced strength", () => {
    const profile = profileOf({
      cards: [
        ...Array.from({ length: 17 }, (_, index) => weakCard(`eigen-${index}`)),
        ...Array.from({ length: 12 }, (_, index) => strongCard(`matrix-${index}`)),
      ],
    });

    expect(profile.weaknesses).toHaveLength(1);
    expect(profile.weaknesses[0]).toMatchObject({
      topic: "Eigenvectors",
      topicSource: "student-topic",
      attempts: 17 * 6,
      uniqueItems: 17,
      evidence: ["flashcards"],
    });
    expect(profile.weaknesses[0]?.mastery).toBeLessThan(0.4);
    expect(profile.weaknesses[0]?.confidence).toBeGreaterThanOrEqual(0.75);
    // Aggregate card state has no dates per review, so no trend is claimed from it.
    expect(profile.weaknesses[0]?.trend).toBeUndefined();

    expect(profile.strengths.map((signal) => signal.topic)).toEqual(["Matrix multiplication"]);
    expect(profile.evidenceSummary.flashcardReviews).toBe(29 * 6);
    expect(profile.recentTrend).toBe("unknown");
    expect(profile.recommendedFocus).toEqual([
      expect.objectContaining({
        reason: "low_mastery",
        action: "teach",
        target: expect.objectContaining({ kind: "topic", label: "Eigenvectors" }),
        evidence: expect.objectContaining({ count: 102, uniqueItems: 17, sources: ["flashcards"] }),
      }),
    ]);
  });

  it("caps a card that was forgotten on its last review", () => {
    const profile = profileOf({
      cards: Array.from({ length: 12 }, (_, index) => strongCard(`matrix-${index}`, { fsrsState: 3 })),
    });
    expect(profile.strengths).toEqual([]);
    expect(profile.weaknesses[0]?.topic).toBe("Matrix multiplication");
  });

  it("treats a strong topic that has slipped as decay rather than a new weakness", () => {
    const profile = profileOf({
      pastPaperAttempts: [
        ...Array.from({ length: 5 }, (_, index) =>
          examAttempt({ id: `old-${index}`, topicIds: ["graphs"], awarded: 1, max: 1, at: NOW - 30 * DAY + index })
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          examAttempt({ id: `new-${index}`, topicIds: ["graphs"], awarded: 1, max: 2, at: NOW - DAY + index })
        ),
      ],
    });

    const graphs = profile.weaknesses.find((signal) => signal.topic === "Algebra: graphs");
    expect(graphs).toMatchObject({ trend: "declining", previousAccuracy: 1, recentAccuracy: 0.5 });
    expect(graphs?.mastery).toBeGreaterThanOrEqual(0.6);
    expect(profile.topics.find((topic) => topic.topicKey === "spec:graphs")?.memory).toContain("decaying");
    // No cards to retrieve from, so recovery happens through practice.
    expect(profile.recommendedFocus[0]).toMatchObject({ reason: "knowledge_decay", action: "practice" });
  });

  it("flags a decline as a weakness to review when the topic was never strong", () => {
    const profile = profileOf({
      pastPaperAttempts: [
        ...Array.from({ length: 5 }, (_, index) =>
          examAttempt({ id: `old-${index}`, topicIds: ["graphs"], awarded: 7, max: 10, at: NOW - 30 * DAY + index })
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          examAttempt({ id: `new-${index}`, topicIds: ["graphs"], awarded: 3, max: 10, at: NOW - DAY + index })
        ),
      ],
    });
    const graphs = profile.topics.find((topic) => topic.topicKey === "spec:graphs");
    expect(graphs).toMatchObject({ demonstration: "weak", memory: [] });
    expect(profile.recommendedFocus[0]).toMatchObject({ reason: "declining_mastery", action: "review" });
  });

  it("trusts recent work over contradictory old work", () => {
    const profile = profileOf({
      pastPaperAttempts: [
        ...Array.from({ length: 10 }, (_, index) =>
          examAttempt({ id: `old-${index}`, topicIds: ["graphs"], awarded: 0, max: 1, at: NOW - 200 * DAY + index })
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          examAttempt({ id: `new-${index}`, topicIds: ["graphs"], awarded: 1, max: 1, at: NOW - (10 - index) * DAY })
        ),
      ],
    });
    expect(profile.weaknesses).toEqual([]);
    expect(profile.strengths.map((signal) => signal.topic)).toEqual(["Algebra: graphs"]);
    expect(profile.improving.map((signal) => signal.topic)).toEqual(["Algebra: graphs"]);
    expect(profile.recentTrend).toBe("improving");
  });

  it("fades very old evidence into something to check rather than a verdict", () => {
    const profile = profileOf({
      pastPaperAttempts: Array.from({ length: 17 }, (_, index) =>
        examAttempt({ id: `ancient-${index}`, topicIds: ["graphs"], awarded: 0, max: 1, at: NOW - 3 * 365 * DAY + index })
      ),
    });
    expect(profile.weaknesses).toEqual([]);
    expect(profile.uncertain.map((signal) => signal.topic)).toEqual(["Algebra: graphs"]);
  });

  it("cannot become confident from retries of one question", () => {
    const profile = profileOf({
      pastPaperAttempts: Array.from({ length: 6 }, (_, index) =>
        examAttempt({
          id: `retry-${index}`,
          questionId: "same-question",
          attemptNumber: index + 1,
          topicIds: ["graphs"],
          awarded: 0,
          max: 4,
          at: NOW - (6 - index) * DAY,
        })
      ),
    });
    expect(profile.weaknesses).toEqual([]);
    expect(profile.uncertain[0]).toMatchObject({ topic: "Algebra: graphs", uniqueItems: 1, attempts: 6 });
  });

  it("leaves out a topic it cannot name", () => {
    const profile = profileOf({
      cards: Array.from({ length: 17 }, (_, index) =>
        weakCard(`ghost-${index}`, { topicIds: ["deleted-topic"] })
      ),
    });
    expect(profile.weaknesses).toEqual([]);
    expect(profile.uncertain).toEqual([]);
  });

  it("gives the same profile, in the same order, however the evidence arrives", () => {
    const cards = [
      ...Array.from({ length: 17 }, (_, index) => weakCard(`vectors-${index}`, { topicIds: ["vectors"] })),
      ...Array.from({ length: 17 }, (_, index) => weakCard(`eigen-${index}`)),
    ];
    const attempts = Array.from({ length: 8 }, (_, index) =>
      examAttempt({ id: `a-${index}`, topicIds: ["graphs"], awarded: index % 2, max: 1, at: NOW - index * DAY })
    );
    const forward = profileOf({ cards, pastPaperAttempts: attempts });
    const reversed = profileOf({ cards: [...cards].reverse(), pastPaperAttempts: [...attempts].reverse() });

    expect(reversed).toEqual(forward);
    // Identical evidence ties, and the tie always breaks the same way.
    expect(forward.weaknesses.map((signal) => signal.topic).slice(0, 2)).toEqual(["Eigenvectors", "Vector spaces"]);
  });

  it("leaves out malformed and duplicate records and says how many", () => {
    const valid = examAttempt({ id: "valid", topicIds: ["graphs"], awarded: 1, max: 1, at: NOW - DAY });
    const profile = profileOf({
      pastPaperAttempts: [
        valid,
        valid,
        { ...examAttempt({ id: "no-time", awarded: 1, max: 1, at: NOW }), markedAt: Number.NaN, updatedAt: Number.NaN },
        examAttempt({ id: "seconds", awarded: 1, max: 1, at: 1_700_000_000 }),
        examAttempt({ id: "future", awarded: 1, max: 1, at: NOW + 5 * DAY }),
      ],
    });
    expect(profile.evidenceSummary.pastPaperAttempts).toBe(2);
    expect(profile.diagnostics.droppedObservations).toBe(3);
    expect(profile.evidenceSummary.lastEvidenceAt).toBe(NOW);
  });

  it("has nothing to recommend when there is nothing to act on", () => {
    const profile = profileOf({
      cards: Array.from({ length: 12 }, (_, index) => strongCard(`matrix-${index}`)),
    });
    expect(profile.strengths).toHaveLength(1);
    expect(profile.recommendedFocus).toEqual([]);
  });

  it("keeps untested specification topics apart from weak ones", () => {
    const profile = profileOf({
      specification: {
        id: "8300",
        title: "AQA GCSE Mathematics",
        topics: [
          { id: "graphs", label: "Algebra: graphs" },
          { id: "probability", label: "Probability" },
          { id: "vectors", label: "Geometry: vectors" },
        ],
      },
      pastPaperAttempts: Array.from({ length: 3 }, (_, index) =>
        examAttempt({ id: `g-${index}`, topicIds: ["graphs"], awarded: 2, max: 2, at: NOW - index * DAY })
      ),
    });

    expect(profile.coverage).toEqual({
      specificationId: "8300",
      specificationTitle: "AQA GCSE Mathematics",
      totalTopics: 3,
      assessedTopics: 1,
      notYetAssessed: [
        { topicKey: "spec:probability", label: "Probability" },
        { topicKey: "spec:vectors", label: "Geometry: vectors" },
      ],
      // Three full-mark answers: promising, but not yet enough evidence to call strong.
      byDemonstration: { none: 2, insufficient: 0, weak: 0, developing: 1, strong: 0 },
    });
    expect([...profile.weaknesses, ...profile.uncertain]).toEqual([]);
    expect(profile.recommendedFocus.map((item) => [item.reason, item.action, item.target.label])).toEqual([
      ["not_yet_assessed", "diagnose", "Probability"],
      ["not_yet_assessed", "diagnose", "Geometry: vectors"],
    ]);
  });

  it("suggests retrieval when a topic's cards are due", () => {
    const profile = profileOf({
      cards: Array.from({ length: 12 }, (_, index) => strongCard(`matrix-${index}`, { dueDate: NOW - DAY })),
    });
    expect(profile.recommendedFocus).toEqual([
      expect.objectContaining({
        reason: "due_for_retrieval",
        action: "retrieve",
        evidence: expect.objectContaining({ dueCards: 12 }),
      }),
    ]);
  });
});

describe("topic states", () => {
  const stateOf = (profile: LearnerProfile, topicKey: string) =>
    profile.topics.find((topic) => topic.topicKey === topicKey);

  it("keeps material a student has seen apart from knowledge they have shown", () => {
    const profile = profileOf({
      exposureItems: [
        { kind: "notebook", id: "nb-1", topicIds: ["eigen"], at: NOW - 3 * DAY },
        { kind: "source", id: "src-1", topicIds: ["eigen", "vectors"], at: NOW - DAY },
      ],
    });

    expect(stateOf(profile, "topic:eigen")).toMatchObject({
      demonstration: "none",
      exposure: { notebooks: 1, sources: 1, cards: 0, lastExposedAt: NOW - DAY },
      decision: { action: "diagnose", reason: "untested_exposure" },
    });
    expect([...profile.weaknesses, ...profile.uncertain, ...profile.strengths]).toEqual([]);
    expect(profile.recommendedFocus.map((item) => item.reason)).toEqual(["untested_exposure", "untested_exposure"]);
  });

  it("counts cards that have never been reviewed as exposure, not evidence", () => {
    const profile = profileOf({
      cards: ["a", "b", "c"].map((id) => card(id, { reps: 0, lastReview: undefined, createdAt: NOW - DAY })),
    });
    expect(profile.evidenceSummary.flashcardReviews).toBe(0);
    expect(stateOf(profile, "topic:eigen")).toMatchObject({
      demonstration: "none",
      exposure: { cards: 3 },
      decision: { action: "diagnose", reason: "untested_exposure" },
    });
  });

  it("gives a declared topic the student has not reached no decision at all", () => {
    const profile = profileOf({ declaredTopicKeys: ["topic:matrix"] });
    expect(stateOf(profile, "topic:matrix")).toEqual({
      topicKey: "topic:matrix",
      label: "Matrix multiplication",
      source: "student-topic",
      provenance: "student_defined",
      declared: true,
      exposure: { notebooks: 0, sources: 0, cards: 0 },
      demonstration: "none",
      memory: [],
    });
    expect(profile.recommendedFocus).toEqual([]);
  });

  it("decides to leave a strong, fresh topic alone", () => {
    const profile = profileOf({
      cards: Array.from({ length: 12 }, (_, index) => strongCard(`matrix-${index}`)),
    });
    expect(stateOf(profile, "topic:matrix")).toMatchObject({
      demonstration: "strong",
      memory: [],
      decision: { action: "leave_alone", reason: "stable_strength" },
    });
    expect(profile.recommendedFocus).toEqual([]);
  });

  it("sees decay only where dated history shows the topic was strong", () => {
    const aggregateOnly = profileOf({
      cards: Array.from({ length: 12 }, (_, index) => weakCard(`eigen-${index}`, { fsrsState: 3 })),
    });
    expect(stateOf(aggregateOnly, "topic:eigen")?.memory).toEqual([]);

    const cards = Array.from({ length: 6 }, (_, index) => card(`c${index}`));
    const slipped = profileOf({
      cards,
      flashcardReviewEvents: cards.flatMap((item) => [
        reviewEvent(`${item.id}-old`, item.id, NOW - 20 * DAY, true, "good"),
        reviewEvent(`${item.id}-new`, item.id, NOW - DAY, false, "again"),
      ]),
    });
    expect(stateOf(slipped, "topic:eigen")).toMatchObject({
      memory: ["decaying"],
      decision: { action: "retrieve", reason: "knowledge_decay" },
    });
  });

  it("counts every specification topic by what its evidence shows", () => {
    const profile = profileOf({
      specification: {
        id: "8300",
        title: "AQA GCSE Mathematics",
        topics: [
          { id: "graphs", label: "Algebra: graphs" },
          { id: "probability", label: "Probability" },
          { id: "vectors", label: "Geometry: vectors" },
        ],
      },
      pastPaperAttempts: Array.from({ length: 17 }, (_, index) =>
        examAttempt({ id: `g-${index}`, topicIds: ["graphs"], awarded: 0, max: 1, at: NOW - index * DAY })
      ),
    });
    expect(profile.coverage?.byDemonstration).toEqual({
      none: 2,
      insufficient: 0,
      weak: 1,
      developing: 0,
      strong: 0,
    });
    expect(stateOf(profile, "spec:probability")).toMatchObject({
      provenance: "verified_specification",
      declared: true,
      decision: { action: "diagnose", reason: "not_yet_assessed" },
    });
  });
});

describe("concept hierarchy", () => {
  const studentConcept = (key: string, label: string, parentKey?: string): LearningConcept => ({
    key,
    label,
    source: "student-topic",
    provenance: "student_defined",
    verified: true,
    ...(parentKey ? { parentKey } : {}),
  });
  const HIERARCHY: LearningConcept[] = [
    studentConcept("topic:algebra", "Algebra"),
    studentConcept("topic:quadratics", "Quadratics", "topic:algebra"),
    studentConcept("topic:discriminants", "Discriminants", "topic:quadratics"),
    studentConcept("topic:sequences", "Sequences", "topic:algebra"),
  ];
  const stateOf = (profile: LearnerProfile, topicKey: string) =>
    profile.topics.find((topic) => topic.topicKey === topicKey);
  const tagged = (prefix: string, count: number, topic: string, overrides: Partial<FlashcardEvidenceCard> = {}) =>
    Array.from({ length: count }, (_, index) => card(`${prefix}-${index}`, { topicIds: [topic], ...overrides }));

  it("rolls a finer concept's evidence up into the concepts above it", () => {
    const profile = profileOf({ concepts: HIERARCHY, cards: tagged("q", 6, "quadratics", { lapses: 4, difficulty: 8 }) });
    expect(stateOf(profile, "topic:quadratics")?.signal?.attempts).toBe(36);
    expect(stateOf(profile, "topic:algebra")).toMatchObject({ signal: { attempts: 36 } });
    expect(stateOf(profile, "topic:quadratics")?.parentKey).toBe("topic:algebra");
  });

  it("judges a concept with too little evidence at the level that has enough", () => {
    const profile = profileOf({
      concepts: HIERARCHY,
      cards: [
        ...tagged("s", 17, "sequences", { difficulty: 2 }),
        card("d-0", { topicIds: ["discriminants"], reps: 1, lapses: 1, difficulty: 9 }),
      ],
    });

    expect(stateOf(profile, "topic:discriminants")).toMatchObject({
      demonstration: "insufficient",
      deferredTo: "topic:algebra",
    });
    expect(stateOf(profile, "topic:discriminants")?.decision).toBeUndefined();
    expect(stateOf(profile, "topic:algebra")?.demonstration).toBe("strong");
    expect(profile.uncertain.map((signal) => signal.topicKey)).not.toContain("topic:discriminants");
    expect(profile.recommendedFocus).toEqual([]);
  });

  it("names the specific concept when it explains a broader weakness", () => {
    const profile = profileOf({ concepts: HIERARCHY, cards: tagged("q", 17, "quadratics", { lapses: 4, difficulty: 8 }) });

    expect(stateOf(profile, "topic:algebra")).toMatchObject({
      decision: { reason: "low_mastery" },
      coveredBy: ["topic:quadratics"],
    });
    expect(profile.recommendedFocus.map((item) => item.target.kind === "topic" && item.target.topicKey)).toEqual([
      "topic:quadratics",
    ]);
  });

  it("never hides a broad weakness behind a finer concept that is merely due", () => {
    const profile = profileOf({
      concepts: HIERARCHY,
      cards: [
        ...tagged("a", 20, "algebra", { lapses: 4, difficulty: 8 }),
        ...tagged("s", 12, "sequences", { difficulty: 2, dueDate: NOW - DAY }),
      ],
    });

    expect(stateOf(profile, "topic:algebra")?.coveredBy).toBeUndefined();
    expect(profile.recommendedFocus.map((item) => [item.reason, item.target.kind === "topic" && item.target.topicKey])).toEqual(
      expect.arrayContaining([
        ["low_mastery", "topic:algebra"],
        ["due_for_retrieval", "topic:sequences"],
      ])
    );
  });

  it("treats an answer testing two concepts as weaker evidence for each", () => {
    const single = profileOf({ concepts: HIERARCHY, cards: tagged("q", 6, "quadratics", { difficulty: 2 }) });
    const mixed = profileOf({
      concepts: HIERARCHY,
      cards: Array.from({ length: 6 }, (_, index) =>
        card(`m-${index}`, { topicIds: ["quadratics", "sequences"], difficulty: 2 })
      ),
    });
    const confidence = (profile: LearnerProfile) => stateOf(profile, "topic:quadratics")?.signal?.confidence ?? 0;

    expect(confidence(mixed)).toBeLessThan(confidence(single));
    // Same answers, same accuracy: sharing the weight changes how sure Jami is, not the score.
    expect(stateOf(mixed, "topic:quadratics")?.signal?.accuracy).toBeCloseTo(
      stateOf(single, "topic:quadratics")?.signal?.accuracy ?? 0,
      10
    );
    // Both halves are algebra, so algebra above them still gets every whole answer.
    expect(stateOf(mixed, "topic:algebra")?.signal?.confidence).toBeCloseTo(
      stateOf(single, "topic:algebra")?.signal?.confidence ?? 0,
      10
    );
  });

  it("counts a concept tagged with its own parent as one concept", () => {
    const child = profileOf({ concepts: HIERARCHY, cards: tagged("q", 6, "quadratics", { difficulty: 2 }) });
    const childAndParent = profileOf({
      concepts: HIERARCHY,
      cards: Array.from({ length: 6 }, (_, index) =>
        card(`q-${index}`, { topicIds: ["quadratics", "algebra"], difficulty: 2 })
      ),
    });
    expect(stateOf(childAndParent, "topic:quadratics")?.signal?.confidence).toBe(
      stateOf(child, "topic:quadratics")?.signal?.confidence
    );
  });

  it("counts a merged Topic's history towards the Topic it became", () => {
    const profile = profileOf({
      concepts: HIERARCHY,
      conceptRedirects: { "topic:old-quadratics": "topic:quadratics" },
      cards: tagged("old", 17, "old-quadratics", { lapses: 4, difficulty: 8 }),
    });
    expect(stateOf(profile, "topic:quadratics")?.signal?.attempts).toBe(102);
    expect(stateOf(profile, "topic:old-quadratics")).toBeUndefined();
  });

  it("never reasons over an AI-suggested concept", () => {
    const profile = profileOf({
      concepts: [
        ...HIERARCHY,
        { key: "topic:ghost", label: "Ghost", source: "student-topic", provenance: "ai_suggested", verified: false },
      ],
      cards: tagged("g", 17, "ghost", { lapses: 4, difficulty: 8 }),
    });
    expect(stateOf(profile, "topic:ghost")).toBeUndefined();
    expect(profile.weaknesses).toEqual([]);
  });

  it("gives the same hierarchy-aware profile however the evidence and concepts arrive", () => {
    const cards = [
      ...tagged("q", 17, "quadratics", { lapses: 4, difficulty: 8 }),
      ...tagged("s", 12, "sequences", { difficulty: 2, dueDate: NOW - DAY }),
      card("d-0", { topicIds: ["discriminants"], reps: 1, lapses: 1, difficulty: 9 }),
    ];
    const forward = profileOf({ concepts: HIERARCHY, cards });
    const reversed = profileOf({ concepts: [...HIERARCHY].reverse(), cards: [...cards].reverse() });
    expect(reversed).toEqual(forward);
  });
});

describe("flashcard review history", () => {
  it("measures a flashcard trend once reviews are recorded", () => {
    const cards = Array.from({ length: 6 }, (_, index) => card(`c${index}`));
    const events = cards.flatMap((item) => [
      reviewEvent(`${item.id}-old`, item.id, NOW - 10 * DAY, false, "again"),
      reviewEvent(`${item.id}-new`, item.id, NOW - DAY, true, "good"),
    ]);
    const profile = profileOf({ cards, flashcardReviewEvents: events });

    expect(signalFor(profile, "Eigenvectors")).toMatchObject({
      trend: "improving",
      previousAccuracy: 0,
      recentAccuracy: 1,
      evidence: ["flashcards"],
    });
    expect(profile.evidenceSummary.flashcardReviewEvents).toBe(12);
  });

  it("scores a card once per study day, from the first answer that day", () => {
    const morning = NOW - 2 * DAY;
    const profile = profileOf({
      cards: [card("c0"), card("c1")],
      flashcardReviewEvents: [
        reviewEvent("e3", "c0", morning + 120_000, true, "good"),
        reviewEvent("e1", "c0", morning, false, "again"),
        reviewEvent("e2", "c0", morning + 60_000, false, "again"),
      ],
    });
    expect(profile.evidenceSummary.flashcardReviewEvents).toBe(1);
    expect(profile.diagnostics.observations).toBe(2);
    // c0's first answer that day was a lapse; c1 is still read from its totals.
    expect(signalFor(profile, "Eigenvectors")?.accuracy).toBeLessThan(0.5);
  });

  it("keeps one card reviewed every day from dominating its topic", () => {
    const daily = Array.from({ length: 30 }, (_, index) =>
      reviewEvent(`daily-${index}`, "favourite", NOW - index * DAY, true, "good")
    );
    const profile = profileOf({
      cards: [card("favourite"), weakCard("b"), weakCard("c"), weakCard("d")],
      flashcardReviewEvents: daily,
    });
    const eigen = profile.weaknesses.find((signal) => signal.topic === "Eigenvectors");
    expect(eigen?.mastery).toBeLessThan(0.6);
    expect(eigen?.trend).toBeUndefined();
  });

  it("ignores history for deleted cards and for cards from another deck", () => {
    const profile = profileOf({
      cards: [card("c0")],
      flashcardReviewEvents: [
        reviewEvent("ghost", "deleted-card", NOW - DAY, false, "again"),
        { ...reviewEvent("moved", "c0", NOW - DAY, false, "again"), deckId: "other-deck" },
      ],
    });
    expect(profile.evidenceSummary.flashcardReviewEvents).toBe(0);
    expect(profile.diagnostics.observations).toBe(1);
  });
});

describe("recurring errors", () => {
  it("recognises the same lost mark across a retry and another question", () => {
    const justification = { criterion: "Justifies the final conclusion", awarded: false };
    const profile = profileOf({
      pastPaperAttempts: [
        examAttempt({
          id: "q1-a1", questionId: "q1", awarded: 4, max: 8, at: NOW - 10 * DAY,
          criteria: [justification, { criterion: "Mark 1", awarded: false }],
        }),
        examAttempt({
          id: "q1-a2", questionId: "q1", attemptNumber: 2, awarded: 6, max: 8, at: NOW - 9 * DAY,
          criteria: [justification, { criterion: "Method", awarded: false }],
        }),
        examAttempt({
          id: "q2-a1", questionId: "q2", awarded: 3, max: 6, at: NOW - 2 * DAY,
          criteria: [{ criterion: "States a conclusion about the trend", awarded: false }],
        }),
      ],
    });

    expect(profile.recurringErrors).toHaveLength(1);
    expect(profile.recurringErrors[0]).toMatchObject({
      category: "insufficient_justification",
      occurrences: 3,
      opportunities: 3,
      uniqueItems: 2,
      status: "active",
      evidence: ["past-paper"],
      detection: ["criterion-wording"],
    });
    expect(profile.recurringErrors[0]?.confidence).toBeGreaterThanOrEqual(0.75);
    expect(profile.recommendedFocus[0]).toMatchObject({
      reason: "persistent_error",
      action: "practice",
      target: { kind: "error", category: "insufficient_justification" },
    });
  });

  it("reads missing units straight from the scheme and candidate values", () => {
    const profile = profileOf({
      pastPaperAttempts: ["a", "b"].map((id, index) =>
        examAttempt({
          id, awarded: 1, max: 2, at: NOW - index * DAY,
          criteria: [{ criterion: "Final answer", awarded: false, schemeValue: "12 m/s", candidateValue: "12" }],
        })
      ),
    });
    expect(profile.recurringErrors[0]).toMatchObject({
      category: "missing_units",
      occurrences: 2,
      detection: ["marking-values"],
    });
  });

  it("reads a rounding slip from the values", () => {
    const profile = profileOf({
      pastPaperAttempts: ["a", "b"].map((id, index) =>
        examAttempt({
          id, awarded: 1, max: 2, at: NOW - index * DAY,
          criteria: [{ criterion: "Accuracy", awarded: false, schemeValue: "3.14", candidateValue: "3.1416" }],
        })
      ),
    });
    expect(profile.recurringErrors.map((error) => error.category)).toEqual(["incorrect_precision"]);
  });

  it("believes the values over the wording when they disagree", () => {
    const profile = profileOf({
      pastPaperAttempts: ["a", "b"].map((id, index) =>
        examAttempt({
          id, awarded: 0, max: 2, at: NOW - index * DAY,
          criteria: [{ criterion: "Correct units", awarded: false, schemeValue: "12 m/s", candidateValue: "15 m/s" }],
        })
      ),
    });
    expect(profile.recurringErrors).toEqual([]);
  });

  it("names nothing from generic criteria", () => {
    const profile = profileOf({
      pastPaperAttempts: ["a", "b", "c", "d"].map((id, index) =>
        examAttempt({
          id, awarded: 0, max: 4, at: NOW - index * DAY,
          criteria: ["Mark 1", "Method", "Knowledge", "Accuracy"].map((criterion) => ({ criterion, awarded: false })),
        })
      ),
    });
    expect(profile.recurringErrors).toEqual([]);
  });

  describe("lifecycle", () => {
    const units = (awarded: boolean) => [{ criterion: "Gives the correct units", awarded }];

    it("is emerging when it has happened twice among more successes", () => {
      const profile = profileOf({
        pastPaperAttempts: [true, true, true, false, false].map((awarded, index) =>
          examAttempt({ id: `u${index}`, awarded: awarded ? 2 : 1, max: 2, at: NOW - (10 - index) * DAY, criteria: units(awarded) })
        ),
      });
      expect(profile.recurringErrors[0]).toMatchObject({ category: "missing_units", status: "emerging" });
      expect(profile.recommendedFocus).toEqual([]);
    });

    it("is improving once the latest two chances earned the mark", () => {
      const profile = profileOf({
        pastPaperAttempts: [false, false, true, true].map((awarded, index) =>
          examAttempt({ id: `u${index}`, awarded: awarded ? 2 : 1, max: 2, at: NOW - (10 - index) * DAY, criteria: units(awarded) })
        ),
      });
      expect(profile.recurringErrors[0]).toMatchObject({ occurrences: 2, opportunities: 4, status: "improving" });
      expect(profile.recommendedFocus[0]).toMatchObject({
        reason: "recent_improvement_needs_reinforcement",
        target: { kind: "error", category: "missing_units" },
      });
    });

    it("is likely resolved only after a run of successes on different questions", () => {
      const history = (successQuestion: (index: number) => string) =>
        profileOf({
          pastPaperAttempts: [false, false, true, true, true].map((awarded, index) =>
            examAttempt({
              id: `u${index}`,
              questionId: awarded ? successQuestion(index) : `miss-${index}`,
              attemptNumber: 1,
              awarded: awarded ? 2 : 1,
              max: 2,
              at: NOW - (10 - index) * DAY,
              criteria: units(awarded),
            })
          ),
        });

      expect(history((index) => `hit-${index}`).recurringErrors[0]?.status).toBe("likely_resolved");
      expect(history(() => "same-question").recurringErrors[0]?.status).toBe("improving");
    });
  });

  it("counts a multi-mark criterion that lost some of its marks", () => {
    const profile = profileOf({
      pastPaperAttempts: ["a", "b"].map((id, index) =>
        examAttempt({
          id, awarded: 3, max: 4, at: NOW - index * DAY,
          criteria: [{ criterion: "Correct units throughout", awarded: true, awardedMarks: 1, maxMarks: 2 }],
        })
      ),
    });
    expect(profile.recurringErrors.map((error) => error.category)).toEqual(["missing_units"]);
  });

  it("reads improvement notes only on answers that dropped marks", () => {
    const fullMarks = profileOf({
      pastPaperAttempts: ["a", "b", "c"].map((id) =>
        examAttempt({ id, awarded: 4, max: 4, at: NOW - DAY, improvements: ["Include units next time."] })
      ),
    });
    expect(fullMarks.recurringErrors).toEqual([]);

    const lostMarks = profileOf({
      pastPaperAttempts: ["a", "b"].map((id) =>
        examAttempt({ id, awarded: 2, max: 4, at: NOW - DAY, improvements: ["Include units next time."] })
      ),
    });
    expect(lostMarks.recurringErrors[0]).toMatchObject({ category: "missing_units", detection: ["marker-note"] });
  });
});

describe("practice papers", () => {
  it("shape the overall trend without inventing topics", () => {
    const profile = profileOf({
      practicePaperAttempts: [
        practiceAttempt({ id: "older", at: NOW - 20 * DAY, scores: Array(5).fill([2, 2]) }),
        practiceAttempt({ id: "latest", at: NOW - DAY, scores: Array(5).fill([0, 2]) }),
      ],
    });
    expect(profile.recentTrend).toBe("declining");
    expect(profile.weaknesses).toEqual([]);
    expect(profile.evidenceSummary.practiceAttempts).toBe(10);
  });

  it("do not count Tutor-assisted sittings towards a trend", () => {
    const profile = profileOf({
      practicePaperAttempts: [
        practiceAttempt({ id: "older", at: NOW - 20 * DAY, assisted: true, scores: Array(5).fill([2, 2]) }),
        practiceAttempt({ id: "latest", at: NOW - DAY, assisted: true, scores: Array(5).fill([0, 2]) }),
      ],
    });
    expect(profile.recentTrend).toBe("unknown");
  });

  it("skip questions that were left blank or excluded from the total", () => {
    const attempt = practiceAttempt({ id: "p", at: NOW - DAY, scores: [[0, 2], [0, 2]] });
    const profile = profileOf({
      practicePaperAttempts: [
        {
          ...attempt,
          questionResults: [
            { ...attempt.questionResults[0], attempted: false },
            { ...attempt.questionResults[1], counted: false },
          ],
        },
      ],
    });
    expect(profile.evidenceSummary.practiceAttempts).toBe(0);
  });
});

describe("telemetry", () => {
  it("describes a profile without naming anything the student studied", () => {
    const profile = profileOf({
      cards: Array.from({ length: 17 }, (_, index) => weakCard(`eigen-${index}`)),
      pastPaperAttempts: ["a", "b", "c"].map((id, index) =>
        examAttempt({
          id, awarded: 1, max: 2, at: NOW - index * DAY,
          criteria: [{ criterion: "Justifies the conclusion", awarded: false }],
        })
      ),
    });
    const fields = learnerProfileTelemetry(profile);
    expect(fields).toMatchObject({
      scope: "folder",
      weaknesses: 1,
      activeRecurringErrors: 1,
      topRecommendation: "persistent_error",
    });
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain("Eigenvectors");
    expect(serialized).not.toContain("justifying");
    expect(serialized).not.toContain("folder-1");
  });
});
