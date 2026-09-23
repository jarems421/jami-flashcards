import { describe, expect, it } from "vitest";
import { readRevisionReturnHref } from "@/lib/app/routes";
import type { LearningTopicState } from "@/lib/learning/types";
import { readRevisionMarking } from "@/lib/revision/lesson";
import {
  planRevisionNextSteps,
  readRevisionStruggle,
  type RevisionNextStepContext,
} from "@/lib/revision/next-steps";
import { buildRevisionOptions, pickRevisionNeighbour } from "@/lib/revision/options";
import { buildRevisionShelfWrite, decodeRevisionShelfItem } from "@/lib/revision/shelf";
import type { RevisionStepKind, RevisionStepRecord } from "@/lib/revision/types";

/** A finished teach session, with any step overridden. */
function steps(
  overrides: Partial<Record<RevisionStepKind, Partial<RevisionStepRecord>>> = {},
  withRetry = false
): RevisionStepRecord[] {
  const kinds: RevisionStepKind[] = [
    "orient",
    "explain",
    "guided",
    ...(withRetry ? (["retry"] as const) : []),
    "independent",
    "apply",
    "retrieve",
  ];
  return kinds.map((kind) => ({
    kind,
    attempts: 1,
    hintUsed: false,
    skipped: false,
    selfGraded: false,
    ...(kind === "orient" || kind === "explain" ? {} : { verdict: "correct", score: 1, resolvedAt: 1 }),
    ...overrides[kind],
  }));
}

const specContext: RevisionNextStepContext = {
  target: {
    topicKey: "spec:completing-the-square",
    source: "specification",
    conceptLabel: "Completing the square",
    folderId: "maths",
  },
  canWrite: true,
  conceptId: "completing-the-square",
  examQuestionsHref: "/dashboard/practice/questions/new?folderId=maths&concepts=completing-the-square",
  sessionHref: "/dashboard/revision/start?folder=maths&topic=spec%3Acompleting-the-square",
  neighbour: {
    topicKey: "spec:solving-quadratics",
    conceptLabel: "Solving quadratics",
    sessionHref: "/dashboard/revision/start?folder=maths&topic=spec%3Asolving-quadratics",
  },
};

const kindsOf = (context: RevisionNextStepContext, recorded: RevisionStepRecord[]) =>
  planRevisionNextSteps(recorded, context).map((step) => step.kind);

describe("telling why a session went wrong", () => {
  it("reads a misunderstood idea as a conceptual struggle", () => {
    expect(readRevisionStruggle(steps({ apply: { verdict: "incorrect", score: 0, mistake: "concept" } })))
      .toMatchObject({ concept: true, sound: false });
    // Needing the idea explained twice is the idea not landing.
    expect(readRevisionStruggle(steps({}, true)).concept).toBe(true);
    // So is not being able to recall it cold.
    expect(readRevisionStruggle(steps({ retrieve: { verdict: "incorrect", score: 0 } })).concept).toBe(true);
  });

  it("reads lost steps as a procedural struggle", () => {
    expect(readRevisionStruggle(steps({ apply: { verdict: "partial", score: 0.5, mistake: "method" } })))
      .toMatchObject({ method: true, concept: false });
    // Fine on the familiar one, lost on the unfamiliar one.
    expect(readRevisionStruggle(steps({ apply: { verdict: "incorrect", score: 0 } })).method).toBe(true);
    // Needed a nudge with no example to lean on.
    expect(readRevisionStruggle(steps({ independent: { hintUsed: true } })).method).toBe(true);
  });

  it("does not call a slip either", () => {
    expect(readRevisionStruggle(steps({ apply: { verdict: "partial", score: 0.6, mistake: "slip" } })))
      .toEqual({ concept: false, method: false, sound: true });
  });
});

describe("what Jami offers next", () => {
  it("offers flashcards for the idea, and practice for the steps", () => {
    expect(kindsOf(specContext, steps({ apply: { verdict: "incorrect", score: 0, mistake: "concept" } })))
      .toEqual(["flashcards", "session"]);
    expect(kindsOf(specContext, steps({ apply: { verdict: "partial", score: 0.5, mistake: "method" } })))
      .toEqual(["practice", "session"]);
  });

  it("sends a session that held up to real exam questions", () => {
    expect(kindsOf(specContext, steps())).toEqual(["exam-questions", "session"]);
  });

  it("falls back to what exists for a student's own Topic", () => {
    const topicContext: RevisionNextStepContext = {
      ...specContext,
      target: { ...specContext.target, topicKey: "topic:quadratics", source: "student-topic" },
      canWrite: false,
      conceptId: undefined,
      examQuestionsHref: undefined,
      reviewCardsHref: "/dashboard/study?mode=custom&topics=quadratics",
      neighbour: undefined,
    };
    expect(kindsOf(topicContext, steps({}, true))).toEqual(["review-cards"]);
    // With no cards either, another session later is the honest offer.
    expect(kindsOf({ ...topicContext, reviewCardsHref: undefined }, steps({}, true))).toEqual(["session"]);
  });

  it("never offers more than three, and never the same concept as its own neighbour", () => {
    const both = steps({ apply: { verdict: "incorrect", score: 0, mistake: "method" } }, true);
    expect(planRevisionNextSteps(both, specContext).length).toBeLessThanOrEqual(3);
    const selfNeighbour = { ...specContext, neighbour: { ...specContext.neighbour!, topicKey: specContext.target.topicKey } };
    expect(kindsOf(selfNeighbour, steps())).toEqual(["exam-questions"]);
  });
});

describe("marking names the kind of mistake", () => {
  it("keeps a listed kind on a wrong answer and drops anything else", () => {
    expect(readRevisionMarking({ verdict: "incorrect", feedback: "Not quite.", mistake: "method" })?.mistake)
      .toBe("method");
    expect(readRevisionMarking({ verdict: "incorrect", feedback: "Not quite.", mistake: "laziness" })?.mistake)
      .toBeUndefined();
    // A correct answer has no mistake, whatever the marker says.
    expect(readRevisionMarking({ verdict: "correct", feedback: "Yes.", mistake: "slip" })?.mistake)
      .toBeUndefined();
  });
});

function topicState(overrides: Partial<LearningTopicState>): LearningTopicState {
  return {
    topicKey: "spec:x",
    label: "X",
    source: "specification",
    declared: true,
    exposure: { notebooks: 0, sources: 0, cards: 0 },
    ...overrides,
  } as LearningTopicState;
}

describe("the start page's list", () => {
  const headings = new Map([
    ["spec:algebra", "Algebra"],
    ["spec:geometry", "Geometry"],
  ]);
  const options = buildRevisionOptions({
    headings,
    recommendedFocus: [
      { target: { kind: "topic", topicKey: "spec:solving", label: "Solving", source: "specification" } },
    ] as never,
    topics: [
      topicState({ topicKey: "spec:square", label: "Completing the square", parentKey: "spec:algebra" }),
      topicState({
        topicKey: "spec:solving",
        label: "Solving quadratics",
        parentKey: "spec:algebra",
        decision: { action: "teach", reason: "low_mastery" },
      }),
      topicState({
        topicKey: "spec:angles",
        label: "Angles",
        parentKey: "spec:geometry",
        decision: { action: "leave_alone", reason: "stable_strength" },
      }),
      topicState({ topicKey: "topic:mocks", label: "Mock 2 weak spots", source: "student-topic" }),
      topicState({ topicKey: "spec:hidden", label: "Undeclared", declared: false }),
    ],
  });

  it("puts what needs work first and groups the rest under the board's headings", () => {
    expect(options.map((option) => option.topicKey)).toEqual([
      "spec:solving",
      "spec:square",
      "spec:angles",
      "topic:mocks",
    ]);
    expect(options[0]).toMatchObject({ suggested: true, group: "Algebra" });
    expect(options.find((option) => option.topicKey === "spec:angles")?.suggested).toBe(false);
  });

  it("finds a neighbour under the same heading only", () => {
    expect(pickRevisionNeighbour(options, { topicKey: "spec:square" })?.topicKey).toBe("spec:solving");
    expect(pickRevisionNeighbour(options, { topicKey: "spec:angles" })).toBeUndefined();
  });
});

describe("the Tutor shelf", () => {
  const step = {
    kind: "practice" as const,
    topicKey: "spec:square",
    conceptLabel: "Completing the square",
    folderId: "maths",
    conceptId: "square",
  };

  it("keeps only this app's own links, and needs one for a made thing", () => {
    expect(buildRevisionShelfWrite({ ...step, status: "made", href: "https://evil.example" }, 1)).toBeNull();
    expect(buildRevisionShelfWrite({ ...step, status: "made" }, 1)).toBeNull();
    const later = buildRevisionShelfWrite({ ...step, status: "later", href: "https://evil.example" }, 1);
    expect(later).not.toHaveProperty("href");
    expect(decodeRevisionShelfItem("a", later)).toMatchObject({ kind: "practice", status: "later" });
  });

  it("holds nothing but a kind, a concept, a folder and a link", () => {
    const made = buildRevisionShelfWrite({ ...step, status: "made", href: "/dashboard/practice/p1" }, 5);
    expect(Object.keys(made ?? {}).sort()).toEqual(
      ["conceptId", "conceptLabel", "createdAt", "folderId", "href", "kind", "schemaVersion", "status", "topicKey"]
    );
  });
});

describe("where a session sends the student back to", () => {
  it("follows only this app's own pages, and never back into a session", () => {
    expect(readRevisionReturnHref("/dashboard/notebooks/n1")).toBe("/dashboard/notebooks/n1");
    expect(readRevisionReturnHref("https://evil.example")).toBeUndefined();
    expect(readRevisionReturnHref("//evil.example/dashboard")).toBeUndefined();
    expect(readRevisionReturnHref("/dashboard/revision/abc")).toBeUndefined();
  });
});
