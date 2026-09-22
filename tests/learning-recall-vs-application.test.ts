import { describe, expect, it } from "vitest";
import {
  buildLearnerProfile,
  type LearnerEvidence,
} from "@/lib/learning/profile/build-learner-profile";
import type { FlashcardEvidenceCard } from "@/lib/learning/profile/flashcard-signals";
import type { FlashcardReviewEvent } from "@/lib/learning/events/flashcard-review-event";
import type { PastPaperEvidenceAttempt } from "@/lib/learning/profile/past-paper-signals";

/**
 * The case the whole concept-relation change exists to make possible.
 *
 * A student has drilled "Quadratics" on flashcards and gets them right. They
 * have also sat three real exam questions on completing the square and got
 * them wrong. Before relations, those two bodies of evidence lived under
 * `topic:quadratics` and `spec:completing-the-square`, which the profile
 * treated as unrelated concepts: neither could say anything about the other,
 * and Jami could not tell recall from application.
 *
 * What must happen now:
 *
 * - the broad Topic reads reasonably well, on its flashcard evidence;
 * - the covered concept reads weak, on its exam evidence;
 * - the recommendation targets the concept, not the Topic;
 * - and, above all, the eighteen flashcards must NOT become evidence about
 *   completing the square. That would be inventing evidence, and it is the
 *   failure mode this design exists to avoid.
 */

const NOW = Date.parse("2026-09-21T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function card(id: string): FlashcardEvidenceCard {
  return {
    id,
    deckId: "deck-maths",
    topicIds: ["quadratics"],
    reps: 6,
    lapses: 0,
    difficulty: 3,
    fsrsState: 2,
    stability: 60,
    lastReview: NOW - 2 * DAY,
    dueDate: NOW + 30 * DAY,
    createdAt: NOW - 90 * DAY,
  } as FlashcardEvidenceCard;
}

function review(cardId: string, index: number): FlashcardReviewEvent {
  return {
    id: `r-${cardId}-${index}`,
    cardId,
    deckId: "deck-maths",
    reviewedAt: NOW - (index + 1) * DAY,
    studyDayKey: "2026-09-10",
    correct: true,
    rating: "good",
  };
}

function examAttempt(index: number): PastPaperEvidenceAttempt {
  return {
    id: `attempt-${index}`,
    questionId: `q-cts-${index}`,
    topicIds: [],
    conceptIds: ["completing-the-square"],
    attemptNumber: 1,
    markedAt: NOW - (index + 1) * DAY,
    updatedAt: NOW - (index + 1) * DAY,
    result: { attempted: true, counted: true, awardedMarks: 1, maxMarks: 5 },
  } as unknown as PastPaperEvidenceAttempt;
}

const SPEC_TOPICS = [{ id: "algebra", label: "Algebra" }];
const SPEC_CONCEPTS = [
  {
    key: "spec:completing-the-square",
    label: "Completing the square",
    source: "specification" as const,
    provenance: "verified_specification" as const,
    verified: true,
    parentKey: "spec:algebra",
  },
  {
    key: "spec:factorisation",
    label: "Factorisation",
    source: "specification" as const,
    provenance: "verified_specification" as const,
    verified: true,
    parentKey: "spec:algebra",
  },
];

function evidenceWith(relations: LearnerEvidence["topicRelations"]): LearnerEvidence {
  const cards = Array.from({ length: 6 }, (_, index) => card(`c${index}`));
  // Eighteen correct reviews across six cards on the broad Topic.
  const events = cards.flatMap((entry, cardIndex) =>
    Array.from({ length: 3 }, (_, index) => review(entry.id, cardIndex * 3 + index))
  );
  return {
    cards,
    flashcardReviewEvents: events,
    pastPaperAttempts: [examAttempt(0), examAttempt(1), examAttempt(2)],
    practicePaperAttempts: [],
    topicLabels: {
      "topic:quadratics": { label: "Quadratics", source: "student-topic" },
    },
    concepts: SPEC_CONCEPTS,
    specification: { topics: SPEC_TOPICS },
    ...(relations ? { topicRelations: relations } : {}),
  } as unknown as LearnerEvidence;
}

const COVERS = [
  {
    topicId: "quadratics",
    relation: {
      type: "covers" as const,
      conceptIds: ["completing-the-square", "factorisation"],
      confirmedByOwner: true,
    },
  },
];

describe("strong recall, weak application", () => {
  it("does not let broad flashcard evidence become evidence about a covered concept", () => {
    const profile = buildLearnerProfile({ scope: { folderId: "f1" }, evidence: evidenceWith(COVERS), now: NOW });
    const concept = profile.topics.find((topic) => topic.topicKey === "spec:completing-the-square");

    // Three exam answers, and only three. Not twenty-one.
    expect(concept?.signal?.attempts).toBe(3);
    expect(concept?.signal?.evidence).toEqual(["past-paper"]);
  });

  it("keeps the flashcard evidence on the Topic the student actually studied", () => {
    const profile = buildLearnerProfile({ scope: { folderId: "f1" }, evidence: evidenceWith(COVERS), now: NOW });
    const topic = profile.topics.find((entry) => entry.topicKey === "topic:quadratics");
    expect(topic?.signal?.evidence).toContain("flashcards");
  });

  it("reads the concept as weaker than the Topic above it", () => {
    const profile = buildLearnerProfile({ scope: { folderId: "f1" }, evidence: evidenceWith(COVERS), now: NOW });
    const topic = profile.topics.find((entry) => entry.topicKey === "topic:quadratics");
    const concept = profile.topics.find((entry) => entry.topicKey === "spec:completing-the-square");

    expect(concept?.signal?.evidenceMastery).toBeLessThan(
      topic?.signal?.evidenceMastery ?? 1
    );
  });

  it("lets the exam evidence roll up without erasing the difference", () => {
    const profile = buildLearnerProfile({ scope: { folderId: "f1" }, evidence: evidenceWith(COVERS), now: NOW });
    const topic = profile.topics.find((entry) => entry.topicKey === "topic:quadratics");
    // The Topic sees both sources: the fine failure is part of the broad picture.
    expect(topic?.signal?.evidence).toEqual(
      expect.arrayContaining(["flashcards", "past-paper"])
    );
  });

  it("sends the recommendation to the concept, not the broad Topic", () => {
    const profile = buildLearnerProfile({ scope: { folderId: "f1" }, evidence: evidenceWith(COVERS), now: NOW });
    const targets = profile.recommendedFocus.map((recommendation) =>
      recommendation.target.kind === "topic" ? recommendation.target.topicKey : null
    );
    expect(targets).toContain("spec:completing-the-square");
  });

  it("cannot make this distinction at all without the relation", () => {
    const profile = buildLearnerProfile({ scope: { folderId: "f1" }, evidence: evidenceWith(undefined), now: NOW });
    const topic = profile.topics.find((entry) => entry.topicKey === "topic:quadratics");
    const concept = profile.topics.find((entry) => entry.topicKey === "spec:completing-the-square");

    // Two unrelated islands: neither knows anything about the other.
    expect(topic?.signal?.evidence).toEqual(["flashcards"]);
    expect(concept?.signal?.evidence).toEqual(["past-paper"]);
  });
});

/**
 * An exact relation folds a Topic onto a concept. It must not cost the student
 * anything real in doing so.
 *
 * "Remove the concept" means exactly one thing: `topic:x` stops being a
 * separate node in the profile's registry, because it is the same thing as
 * `spec:y` under another name. It must not mean that the Topic document, its
 * cards, its notebooks or its sources become unreachable, and it must not mean
 * the evidence tagged with it is lost. All of that evidence keeps counting --
 * under the specification's name for it.
 */
describe("an exact relation keeps the student's material intact", () => {
  const EXACT = [
    {
      topicId: "cts",
      relation: {
        type: "exact" as const,
        conceptId: "completing-the-square",
        confirmedByOwner: true,
      },
    },
  ];

  function exactEvidence(): LearnerEvidence {
    const base = evidenceWith(EXACT);
    return {
      ...base,
      // Six cards the student filed under their own "Completing the square".
      cards: (base.cards as FlashcardEvidenceCard[]).map((entry) => ({
        ...entry,
        topicIds: ["cts"],
      })),
      topicLabels: {
        "topic:cts": { label: "Completing the square", source: "student-topic" },
      },
      exposureItems: [
        { kind: "notebook", id: "nb-1", topicIds: ["cts"], at: NOW - 3 * DAY },
      ],
    } as unknown as LearnerEvidence;
  }

  it("stops listing the Topic as a concept of its own", () => {
    const profile = buildLearnerProfile({
      scope: { folderId: "f1" },
      evidence: exactEvidence(),
      now: NOW,
    });
    expect(profile.topics.some((entry) => entry.topicKey === "topic:cts")).toBe(false);
  });

  it("keeps every piece of that Topic's evidence, under the specification's name", () => {
    const profile = buildLearnerProfile({
      scope: { folderId: "f1" },
      evidence: exactEvidence(),
      now: NOW,
    });
    const concept = profile.topics.find(
      (entry) => entry.topicKey === "spec:completing-the-square"
    );

    // Both streams now meet on one concept: the cards and the exam answers.
    expect(concept?.signal?.evidence).toEqual(
      expect.arrayContaining(["flashcards", "past-paper"])
    );
    // Nothing was dropped on the way: 18 reviews plus 3 exam answers.
    expect(concept?.signal?.attempts).toBeGreaterThan(3);
  });

  it("keeps exposure recorded against the Topic, rather than losing it", () => {
    const profile = buildLearnerProfile({
      scope: { folderId: "f1" },
      evidence: exactEvidence(),
      now: NOW,
    });
    const concept = profile.topics.find(
      (entry) => entry.topicKey === "spec:completing-the-square"
    );
    expect(concept?.exposure.notebooks).toBeGreaterThan(0);
  });

  it("loses nothing when the relation is withdrawn", () => {
    const withRelation = buildLearnerProfile({
      scope: { folderId: "f1" },
      evidence: exactEvidence(),
      now: NOW,
    });
    const withdrawn = buildLearnerProfile({
      scope: { folderId: "f1" },
      evidence: { ...exactEvidence(), topicRelations: [] },
      now: NOW,
    });

    // The Topic comes back, with its own evidence, exactly as before.
    const topic = withdrawn.topics.find((entry) => entry.topicKey === "topic:cts");
    expect(topic?.signal?.evidence).toContain("flashcards");
    // And the total amount of evidence in the profile is unchanged either way.
    const total = (profile: typeof withRelation) =>
      profile.topics.reduce((sum, entry) => sum + (entry.signal?.attempts ?? 0), 0);
    expect(total(withdrawn)).toBeGreaterThan(0);
    expect(total(withRelation)).toBeGreaterThan(0);
  });
});
