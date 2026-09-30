import { describe, expect, it } from "vitest";
import {
  belongsInPracticeHistory,
  isReadyPracticeSet,
  normalizePracticeSetInfo,
  practiceSetCountForDepth,
  practiceSetMix,
  practiceSetTitle,
} from "@/lib/practice/practice-sets";
import { selectPracticeRecommendations } from "@/lib/practice/practice-recommendations";
import { examSessionCourseName } from "@/lib/practice/exam-course-names";
import { examSessionQualification } from "@/lib/practice/exam-questions";
import { chooseDraftDestinationDeck } from "@/lib/study/decks";
import type { StudyAction } from "@/lib/learning/actions/study-actions";

describe("practice set shape", () => {
  it("builds a short set that still climbs", () => {
    expect(practiceSetMix(5)).toEqual({ easy: 2, medium: 2, hard: 1 });
    expect(practiceSetMix(3)).toEqual({ easy: 1, medium: 1, hard: 1 });
    expect(practiceSetMix(1)).toEqual({ easy: 0, medium: 1, hard: 0 });
    const ten = practiceSetMix(40);
    expect(ten.easy + ten.medium + ten.hard).toBe(10);
  });

  it("maps a source's thoroughness to a question count", () => {
    expect(practiceSetCountForDepth("low")).toBe(3);
    expect(practiceSetCountForDepth("medium")).toBe(5);
    expect(practiceSetCountForDepth("high")).toBe(8);
  });

  it("titles a set from its focus", () => {
    expect(practiceSetTitle("separating variables: which side to divide")).toBe(
      "Separating variables: which side to divide"
    );
    expect(practiceSetTitle("")).toBe("Practice set");
    expect(practiceSetTitle("x".repeat(200)).length).toBeLessThanOrEqual(90);
  });
});

describe("where a practice set shows", () => {
  const set = normalizePracticeSetInfo({ origin: "tutor", status: "ready", title: "Enzymes", focus: "enzymes" })!;

  it("is ready until something is answered, and never once dismissed", () => {
    expect(isReadyPracticeSet({ status: "active", answeredCount: 0, practiceSet: set })).toBe(true);
    expect(isReadyPracticeSet({ status: "active", answeredCount: 1, practiceSet: set })).toBe(false);
    expect(
      isReadyPracticeSet({ status: "abandoned", answeredCount: 0, practiceSet: { ...set, status: "dismissed" } })
    ).toBe(false);
    expect(isReadyPracticeSet({ status: "active", answeredCount: 0 })).toBe(false);
  });

  it("joins history only once it has been worked on", () => {
    expect(belongsInPracticeHistory({ status: "active", answeredCount: 0 })).toBe(true);
    expect(belongsInPracticeHistory({ status: "active", answeredCount: 0, practiceSet: set })).toBe(false);
    expect(belongsInPracticeHistory({ status: "active", answeredCount: 2, practiceSet: set })).toBe(true);
  });

  it("reads stored set info defensively", () => {
    expect(normalizePracticeSetInfo({ origin: "someone", title: "x" })).toBeUndefined();
    expect(normalizePracticeSetInfo({ origin: "source", status: "odd", title: "" })).toMatchObject({
      origin: "source",
      status: "ready",
      title: "Practice set",
    });
  });
});

describe("sessions without an exam course", () => {
  it("names and marks them by subject and level", () => {
    expect(examSessionCourseName({ subject: "Organic Chemistry", folderName: "Chem" })).toBe("Organic Chemistry");
    expect(examSessionCourseName({ subject: "", folderName: "Chem" })).toBe("Chem");
    expect(examSessionQualification({ studyLevel: "undergraduate" })).toBe("undergraduate university level");
    expect(
      examSessionQualification({
        studyLevel: "gcse-equivalent",
        course: {
          board: "aqa",
          qualification: "gcse",
          specificationId: "8300",
          specificationTitle: "Mathematics",
          componentIds: [],
        },
      })
    ).toBe("gcse");
  });
});

describe("selectPracticeRecommendations", () => {
  const base = {
    priority: 3,
    evidence: { count: 3, uniqueItems: 3, sources: ["practice"] },
    explanationCode: "x",
  } as const;

  it("sends course topics to real past-paper questions and writes sets for the rest", () => {
    const actions = [
      {
        ...base,
        id: "a",
        reason: "low_mastery",
        action: "practice",
        scope: { folderId: "maths" },
        target: { kind: "topic", topicKey: "specification:quadratics", label: "Quadratics", source: "specification" },
        destination: { kind: "question-practice", href: "/dashboard/practice/questions/new?folderId=maths" },
      },
      {
        ...base,
        id: "b",
        reason: "low_confidence",
        action: "diagnose",
        scope: { folderId: "law" },
        target: { kind: "topic", topicKey: "student-topic:t1", label: "Consideration", source: "student-topic" },
        destination: { kind: "topic", href: "/dashboard/topics/t1" },
      },
      {
        ...base,
        id: "c",
        reason: "due_for_retrieval",
        action: "retrieve",
        scope: { folderId: "law" },
        target: { kind: "topic", topicKey: "deck:d1", label: "Deck", source: "deck" },
      },
      {
        ...base,
        id: "d",
        reason: "low_mastery",
        action: "practice",
        scope: { deckId: "d1" },
        target: { kind: "topic", topicKey: "deck:d1", label: "No folder", source: "deck" },
      },
    ] as unknown as StudyAction[];

    expect(selectPracticeRecommendations(actions)).toEqual([
      {
        id: "a",
        folderId: "maths",
        label: "Quadratics",
        why: "This has been difficult so far.",
        setupHref: "/dashboard/practice/questions/new?folderId=maths",
      },
      {
        id: "b",
        folderId: "law",
        label: "Consideration",
        why: "Not enough evidence yet — a few questions will tell.",
      },
    ]);
  });
});

describe("chooseDraftDestinationDeck", () => {
  const decks = [
    { id: "newest", folderIds: [] },
    { id: "bio", folderIds: ["biology"] },
  ];

  it("prefers the deck being studied, then the conversation's folder, then the newest", () => {
    expect(chooseDraftDestinationDeck(decks, { deckId: "bio" })).toBe("bio");
    expect(chooseDraftDestinationDeck(decks, { folderId: "biology" })).toBe("bio");
    expect(chooseDraftDestinationDeck(decks, { deckId: "gone", folderId: "none" })).toBe("newest");
    expect(chooseDraftDestinationDeck([], {})).toBe("");
  });
});
