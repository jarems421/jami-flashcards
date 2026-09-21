import { describe, expect, it } from "vitest";
import {
  buildStudyActions,
  mergeStudyActions,
  type StudyAction,
} from "@/lib/learning/actions/study-actions";
import {
  buildLearnerProfile,
  type LearnerEvidence,
} from "@/lib/learning/profile/build-learner-profile";
import type { FlashcardEvidenceCard } from "@/lib/learning/profile/flashcard-signals";
import type { PastPaperEvidenceAttempt } from "@/lib/learning/profile/past-paper-signals";
import type { LearningConcept } from "@/lib/learning/types";

/**
 * From a decision to somewhere a student can go.
 *
 * Each destination must be a surface Jami already has, and an action nothing
 * can carry out must say so by having no destination -- never a link that
 * pretends. Leaving a topic alone is a decision, not a task.
 */

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 24 * 60 * 60 * 1000;

function card(id: string, overrides: Partial<FlashcardEvidenceCard> = {}): FlashcardEvidenceCard {
  return {
    id,
    deckId: "deck-1",
    topicIds: ["matrix"],
    reps: 6,
    lapses: 0,
    difficulty: 2,
    fsrsState: 2,
    lastReview: NOW - DAY,
    ...overrides,
  };
}

function attempt(id: string, overrides: Partial<PastPaperEvidenceAttempt> = {}): PastPaperEvidenceAttempt {
  return {
    id,
    questionId: id,
    attemptNumber: 1,
    markedAt: NOW - DAY,
    updatedAt: NOW - DAY,
    topicIds: [],
    result: { attempted: true, awardedMarks: 1, maxMarks: 2, criterionResults: [], improvements: [] },
    ...overrides,
  };
}

function profileOf(evidence: Partial<LearnerEvidence>, scope: { folderId?: string; deckId?: string } = { folderId: "folder-1" }) {
  return buildLearnerProfile({
    scope,
    now: NOW,
    evidence: {
      cards: [],
      flashcardReviewEvents: [],
      pastPaperAttempts: [],
      practicePaperAttempts: [],
      topicLabels: {
        "topic:matrix": { label: "Matrix multiplication", source: "student-topic" },
        "topic:eigen": { label: "Eigenvectors", source: "student-topic" },
        "topic:a b/c": { label: "Odd id", source: "student-topic" },
        "deck:deck-1": { label: "Linear algebra", source: "deck" },
      },
      ...evidence,
    },
  });
}

const specification = {
  id: "8300",
  title: "AQA GCSE Mathematics",
  topics: [{ id: "graphs", label: "Algebra: graphs" }],
};

describe("study action destinations", () => {
  it("sends due cards on a student topic to a flashcard session for that topic", () => {
    const actions = buildStudyActions(
      profileOf({ cards: Array.from({ length: 12 }, (_, index) => card(`m${index}`, { dueDate: NOW - DAY })) }),
      { questionPracticeAvailable: false }
    );
    expect(actions).toEqual([
      expect.objectContaining({
        reason: "due_for_retrieval",
        action: "retrieve",
        explanationCode: "due_for_retrieval.retrieve",
        destination: {
          kind: "flashcards",
          // The link carries what the session should do, not just what it covers.
          href: "/dashboard/study?mode=custom&topics=matrix&focus=retrieve&focusCount=12&from=folder%3Afolder-1%7Cdue_for_retrieval%7Ctopic%3Amatrix",
          selection: { topicIds: ["matrix"] },
        },
      }),
    ]);
  });

  it("sends a well-evidenced weak topic to its Topic page", () => {
    const actions = buildStudyActions(
      profileOf({ cards: Array.from({ length: 17 }, (_, index) => card(`e${index}`, { topicIds: ["eigen"], lapses: 4, difficulty: 8 })) }),
      { questionPracticeAvailable: false }
    );
    expect(actions[0]).toMatchObject({
      reason: "low_mastery",
      action: "teach",
      destination: { kind: "topic", href: "/dashboard/topics/eigen" },
    });
  });

  it("sends a specification topic to practice narrowed to it, only when the course can serve it", () => {
    const profile = profileOf({ specification });
    expect(buildStudyActions(profile, { questionPracticeAvailable: true })[0]).toMatchObject({
      reason: "not_yet_assessed",
      action: "diagnose",
      destination: {
        kind: "question-practice",
        href: "/dashboard/practice/questions/new?folderId=folder-1&topics=graphs",
      },
    });
    expect(buildStudyActions(profile, { questionPracticeAvailable: false })[0]?.destination).toBeUndefined();
  });

  it("sends a weak specification concept to practice narrowed to that concept", () => {
    const concepts: LearningConcept[] = [
      { key: "spec:solving", label: "Algebra: solving equations", source: "specification", provenance: "verified_specification", verified: true },
      {
        key: "spec:quadratics",
        label: "Solving quadratic equations",
        source: "specification",
        provenance: "verified_specification",
        verified: true,
        parentKey: "spec:solving",
      },
    ];
    const missed = { attempted: true, awardedMarks: 0, maxMarks: 2, criterionResults: [], improvements: [] };
    const profile = profileOf({
      concepts,
      pastPaperAttempts: ["q1", "q2", "q3"].map((id, index) =>
        attempt(id, { topicIds: ["solving"], conceptIds: ["quadratics"], markedAt: NOW - index * DAY, result: missed })
      ),
    });

    const actions = buildStudyActions(profile, { questionPracticeAvailable: true });
    // The concept carries the decision; the topic above it stands aside rather than repeating it.
    expect(actions.map((action) => (action.target.kind === "topic" ? action.target.topicKey : action.target.kind))).toEqual([
      "spec:quadratics",
    ]);
    expect(actions[0]?.destination).toEqual({
      kind: "question-practice",
      href: "/dashboard/practice/questions/new?folderId=folder-1&concepts=quadratics",
      selection: { conceptIds: ["quadratics"] },
    });
  });

  it("sends a recurring error back to the practice it came from", () => {
    const units = [{ criterion: "Correct units", awarded: false }];
    const fromPastPapers = buildStudyActions(
      profileOf({
        pastPaperAttempts: ["a", "b", "c"].map((id, index) =>
          attempt(id, { markedAt: NOW - index * DAY, result: { attempted: true, awardedMarks: 1, maxMarks: 2, criterionResults: units, improvements: [] } })
        ),
      }),
      { questionPracticeAvailable: true }
    );
    expect(fromPastPapers[0]).toMatchObject({
      reason: "persistent_error",
      destination: { kind: "question-practice", href: "/dashboard/practice/questions/new?folderId=folder-1" },
    });

    const fromPracticePapers = buildStudyActions(
      profileOf({
        practicePaperAttempts: ["a", "b", "c"].map((id, index) => ({
          id,
          paperId: "paper-1",
          assisted: false,
          markedAt: NOW - index * DAY,
          updatedAt: NOW - index * DAY,
          questionResults: [{ questionId: "q1", attempted: true, counted: true, awardedMarks: 1, maxMarks: 2, criterionResults: units, improvements: [] }],
        })),
      }),
      { questionPracticeAvailable: true }
    );
    expect(fromPracticePapers[0]?.destination).toEqual({
      kind: "practice-papers",
      href: "/dashboard/folders/folder-1?tab=practice",
      // An error spans topics; its practice is the folder's whole pool.
      selection: {},
    });
  });

  it("offers no destination for a check nothing can carry out", () => {
    const actions = buildStudyActions(
      profileOf({ exposureItems: [{ kind: "notebook", id: "nb", topicIds: ["eigen"], at: NOW }] }),
      { questionPracticeAvailable: true }
    );
    expect(actions[0]).toMatchObject({ reason: "untested_exposure", action: "diagnose" });
    expect(actions[0]?.destination).toBeUndefined();
    expect(mergeStudyActions([actions], { limit: 4, executableOnly: true })).toEqual([]);
  });

  it("never offers leaving a topic alone as something to do", () => {
    const profile = profileOf({ cards: Array.from({ length: 12 }, (_, index) => card(`m${index}`)) });
    expect(profile.topics.find((topic) => topic.topicKey === "topic:matrix")?.decision?.action).toBe("leave_alone");
    expect(buildStudyActions(profile, { questionPracticeAvailable: true })).toEqual([]);
  });

  it("sends untagged cards to their deck, and encodes student-written ids in links", () => {
    const deckActions = buildStudyActions(
      profileOf({ cards: ["a", "b", "c"].map((id) => card(id, { topicIds: [], reps: 0, lastReview: undefined })) }),
      { questionPracticeAvailable: false }
    );
    expect(deckActions[0]?.destination).toEqual({
      kind: "flashcards",
      href: "/dashboard/study?mode=custom&decks=deck-1&focus=diagnose&focusCount=5&from=folder%3Afolder-1%7Cuntested_exposure%7Cdeck%3Adeck-1",
      selection: { deckIds: ["deck-1"] },
    });

    const oddActions = buildStudyActions(
      profileOf({ cards: Array.from({ length: 17 }, (_, index) => card(`o${index}`, { topicIds: ["a b/c"], lapses: 4, difficulty: 8 })) }),
      { questionPracticeAvailable: false }
    );
    expect(oddActions[0]?.destination?.href).toBe("/dashboard/topics/a%20b%2Fc");
  });

  it("gives the same ids for the same decisions, scoped to their folder or deck", () => {
    const evidence = { cards: Array.from({ length: 12 }, (_, index) => card(`m${index}`, { dueDate: NOW - DAY })) };
    const first = buildStudyActions(profileOf(evidence), { questionPracticeAvailable: false });
    const again = buildStudyActions(profileOf(evidence), { questionPracticeAvailable: false });
    expect(again.map((action) => action.id)).toEqual(first.map((action) => action.id));
    expect(first[0]?.id).toBe("folder:folder-1|due_for_retrieval|topic:matrix");

    const deckScoped = buildStudyActions(profileOf(evidence, { deckId: "deck-1" }), { questionPracticeAvailable: false });
    expect(deckScoped[0]?.id.startsWith("deck:deck-1|")).toBe(true);
  });
});

describe("merging study actions across folders", () => {
  function action(id: string, priority: number, href?: string): StudyAction {
    return {
      id,
      reason: "low_confidence",
      action: "diagnose",
      priority,
      target: { kind: "topic", topicKey: `topic:${id}`, label: id, source: "student-topic" },
      evidence: { count: 1, uniqueItems: 1, sources: ["flashcards"] },
      scope: { folderId: "folder" },
      explanationCode: "low_confidence.diagnose",
      ...(href ? { destination: { kind: "flashcards" as const, href, selection: {} } } : {}),
    };
  }

  it("ranks by priority, then by the folder's recency, then by id, showing each destination once", () => {
    const recentFolder = [action("b", 5, "/b"), action("shared-recent", 4, "/shared")];
    const olderFolder = [action("a", 5, "/a"), action("shared-older", 4, "/shared"), action("top", 6, "/top")];
    const merged = mergeStudyActions([recentFolder, olderFolder], { limit: 10, executableOnly: true });
    expect(merged.map((item) => item.id)).toEqual(["top", "b", "a", "shared-recent"]);
  });

  it("stops one busy subject taking every slot", () => {
    // A folder with lots of evidence produces higher-confidence candidates, so
    // ranked on priority alone it would fill Today and hide the other subject.
    const busy = Array.from({ length: 6 }, (_, index) =>
      action(`busy-${index}`, 9 - index * 0.1, `/busy-${index}`)
    );
    const quiet = [action("quiet-1", 3, "/quiet-1"), action("quiet-2", 2, "/quiet-2")];
    const merged = mergeStudyActions([busy, quiet], { limit: 4, executableOnly: true });

    expect(merged).toHaveLength(4);
    expect(merged.filter((item) => item.id.startsWith("quiet")).length).toBeGreaterThan(0);
    expect(merged.filter((item) => item.id.startsWith("busy")).length).toBeLessThanOrEqual(2);
  });

  it("still fills the list for a student with one active subject", () => {
    const only = Array.from({ length: 6 }, (_, index) =>
      action(`only-${index}`, 9 - index, `/only-${index}`)
    );
    const merged = mergeStudyActions([only], { limit: 4, executableOnly: true });
    expect(merged.map((item) => item.id)).toEqual(["only-0", "only-1", "only-2", "only-3"]);
  });

  it("keeps advice already acted on off the list unless asked for it", () => {
    const resting = { ...action("resting", 9, "/resting"), cooldown: "acted_on" as const };
    const fresh = action("fresh", 1, "/fresh");

    expect(
      mergeStudyActions([[resting, fresh]], { limit: 4, executableOnly: true }).map((item) => item.id)
    ).toEqual(["fresh"]);

    expect(
      mergeStudyActions([[resting, fresh]], {
        limit: 4,
        executableOnly: true,
        includeCooling: true,
      }).map((item) => item.id)
    ).toEqual(["resting", "fresh"]);
  });

  it("drops actions with nowhere to go, and respects the limit", () => {
    const merged = mergeStudyActions([[action("x", 9), action("y", 8, "/y"), action("z", 7, "/z")]], {
      limit: 1,
      executableOnly: true,
    });
    expect(merged.map((item) => item.id)).toEqual(["y"]);
  });
});
