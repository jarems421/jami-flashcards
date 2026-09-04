// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyPage from "@/app/dashboard/study/page";
import { getOfflineQueuedReviews } from "@/lib/study/offline-study";

/**
 * Characterization tests for the review commit path.
 *
 * These were written before the study page was broken into components, and
 * they describe what it already did rather than what it ought to do. Their job
 * is to fail loudly if the extraction changes any observable behaviour: which
 * services are called, with what, and what happens to the card afterwards.
 *
 * Anything asserted here is load-bearing. If a later change needs one of these
 * expectations altered, that is a product decision, not a tidy-up.
 */

const fixtures = vi.hoisted(() => {
  const baseCard = {
    userId: "user-1",
    deckId: "deck-1",
    createdAt: 1,
    dueDate: 0,
    tags: [] as string[],
    topicIds: [] as string[],
  };

  return {
    cards: [
      {
        ...baseCard,
        id: "card-1",
        front: "What is ATP?",
        back: "The immediate energy carrier of the cell.",
      },
      {
        ...baseCard,
        id: "card-2",
        front: "What is a ribosome?",
        back: "Where proteins are built.",
      },
    ],
    dailyReviewState: {
      id: "daily-review",
      studyDayKey: "2026-09-04",
      generatedAt: 1,
      requiredCardIds: ["card-1", "card-2"],
      optionalCardIds: [] as string[],
      carryoverRequiredCardIds: [] as string[],
      completedRequiredCardIds: [] as string[],
      completedOptionalCardIds: [] as string[],
      parkedRequiredCardIds: [] as string[],
      requiredRetryCounts: {} as Record<string, number>,
      updatedAt: 1,
    },
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "user-1" } }),
}));

vi.mock("@/services/constellation/constellations", () => ({
  ensureConstellationSetup: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/study/daily-review", () => ({
  ensureDailyReviewState: vi.fn().mockResolvedValue(fixtures.dailyReviewState),
  ensureStudyStateSetup: vi.fn().mockResolvedValue(undefined),
  markDailyReviewCardComplete: vi.fn().mockResolvedValue(undefined),
  recordDailyReviewWeakAttempt: vi
    .fn()
    .mockResolvedValue({ attemptCount: 1, parked: false }),
}));

vi.mock("@/services/study/cards", () => ({
  loadUserCards: vi.fn().mockResolvedValue(fixtures.cards),
  recordSimpleStudyResult: vi.fn().mockResolvedValue(undefined),
  updateCardAfterReview: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/study/decks", () => ({
  getDecks: vi.fn().mockResolvedValue([
    {
      id: "deck-1",
      name: "Biology",
      userId: "user-1",
      createdAt: 1,
      colorPreset: "violet",
      iconPreset: "book",
      folderIds: ["folder-1"],
    },
  ]),
}));

vi.mock("@/services/study/topics", () => ({
  getActiveTopics: vi.fn().mockResolvedValue([]),
}));

// Preparation runs when a session starts, so every test in this file goes
// through it. Mocked to return nothing by default, which is the unprepared deck
// the deterministic modes have to work on anyway; the multiple-choice tests
// hand it real assets.
vi.mock("@/services/study/study-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/study/study-assets")>()),
  loadStudyAssets: vi.fn().mockResolvedValue({}),
  prepareStudyAssets: vi.fn().mockResolvedValue({
    jobId: "job-1",
    status: "completed",
    requested: 0,
    prepared: 0,
    reused: 0,
    failed: 0,
  }),
  checkTypedAnswer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/study/session", () => ({
  closeRemoteStudySession: vi.fn().mockResolvedValue(true),
  loadRemoteActiveStudySession: vi
    .fn()
    .mockResolvedValue({ session: null, foundRemoteSession: false }),
  saveRemoteActiveStudySession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/study/offline", () => ({
  syncOfflineStudyReviews: vi
    .fn()
    .mockResolvedValue({ synced: 0, remaining: 0 }),
}));

vi.mock("@/services/study/goals", () => ({
  applyGoalProgressForAnswer: vi
    .fn()
    .mockResolvedValue({ completedGoals: 0, starsEarned: 0, rewards: [] }),
}));

vi.mock("@/services/study/activity", () => ({
  recordStudyReview: vi.fn().mockResolvedValue(undefined),
  loadStudyActivity: vi.fn().mockResolvedValue({ days: {} }),
}));

const { markDailyReviewCardComplete, recordDailyReviewWeakAttempt } =
  await import("@/services/study/daily-review");
const { recordSimpleStudyResult, updateCardAfterReview } = await import(
  "@/services/study/cards"
);
const { applyGoalProgressForAnswer } = await import("@/services/study/goals");
const { recordStudyReview } = await import("@/services/study/activity");
const { loadStudyAssets, prepareStudyAssets } = await import(
  "@/services/study/study-assets"
);

/** What Jami produces for a card during preparation, trimmed to what is used. */
function preparedAsset(cardId: string, distractors: string[]) {
  return {
    cardId,
    answerShape: "short" as const,
    acceptedAliases: [],
    requiredConcepts: [],
    clozeCandidates: [],
    distractors,
    misconceptions: {},
    confidence: 0.9,
    ambiguous: false,
  };
}

let container: HTMLDivElement;
let root: Root;

// jsdom ships neither of these, and both are load-bearing here: the tutor
// drawer reads a media query on mount, and React only batches inside act() when
// it is told it is in a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label)
  );
}

async function click(label: string) {
  const target = button(label);
  expect(target, `expected a button labelled "${label}"`).toBeDefined();
  await act(async () => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

/** Multiple-choice options carry a number badge, so match on their text, not their start. */
async function chooseOption(text: string) {
  const option = [...document.querySelectorAll('[role="radio"]')].find(
    (candidate) => candidate.textContent?.includes(text)
  );
  expect(option, `expected an option reading "${text}"`).toBeDefined();
  await act(async () => {
    option!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function currentCardId() {
  return document
    .querySelector("[data-study-current-card-id]")
    ?.getAttribute("data-study-current-card-id");
}

function backFace() {
  return document.querySelector(".study-flashcard-face-back");
}

async function pressKey(key: string, code = key) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, code, bubbles: true })
    );
  });
  await settle();
}

async function flip() {
  const shell = document.querySelector("[data-study-current-card-id]");
  expect(shell, "expected a card on screen to flip").not.toBeNull();
  await act(async () => {
    shell!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

beforeEach(async () => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(recordDailyReviewWeakAttempt).mockResolvedValue({
    attemptCount: 1,
    parked: false,
  });
  vi.mocked(applyGoalProgressForAnswer).mockResolvedValue({
    completedGoals: 0,
    starsEarned: 0,
    rewards: [],
  } as never);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<StudyPage />);
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("revealing a card", () => {
  it("keeps the answer out of the accessibility tree until the flip", async () => {
    await click("Start Daily Review");
    expect(document.querySelectorAll(".study-flashcard-face")).toHaveLength(2);
    expect(backFace()?.getAttribute("aria-hidden")).toBe("true");
    expect(backFace()?.hasAttribute("inert")).toBe(true);

    await flip();
    expect(backFace()?.getAttribute("aria-hidden")).toBe("false");
    expect(
      document
        .querySelector(".study-flashcard-face-front")
        ?.hasAttribute("inert")
    ).toBe(true);
  });

  it("shows no rating controls before the reveal", async () => {
    await click("Start Daily Review");
    expect(button("Good")).toBeUndefined();
    await flip();
    expect(button("Good")).toBeDefined();
  });

  it("reveals on Space and rates on the number keys", async () => {
    await click("Start Daily Review");
    const first = currentCardId();
    await pressKey(" ", "Space");
    expect(backFace()?.getAttribute("aria-hidden")).toBe("false");

    await pressKey("3");
    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledTimes(1);
    expect(currentCardId()).not.toBe(first);
  });

  it("ignores the shortcuts while a text field has focus", async () => {
    await click("Start Daily Review");
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true })
      );
    });
    await settle();

    expect(backFace()?.getAttribute("aria-hidden")).toBe("true");
    input.remove();
  });
});

describe("committing a Daily Review answer", () => {
  it("schedules, records, credits goals and completes the obligation on Good", async () => {
    await click("Start Daily Review");
    const first = currentCardId()!;
    await flip();
    await click("Good");

    expect(vi.mocked(updateCardAfterReview)).toHaveBeenCalledTimes(1);
    const [cardId, command] = vi.mocked(updateCardAfterReview).mock.calls[0];
    expect(cardId).toBe(first);
    // A successful daily answer writes a real FSRS schedule and clears the
    // one-day risk override a previous struggle may have left behind.
    expect(command.values).toEqual(
      expect.objectContaining({
        dueDate: expect.any(Number),
        stability: expect.any(Number),
        difficulty: expect.any(Number),
        reps: expect.any(Number),
      })
    );
    expect(command.clearMemoryRiskOverrideDayKey).toBe(true);

    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
      expect.objectContaining({ isCorrect: true, sessionKind: "daily" })
    );
    expect(vi.mocked(applyGoalProgressForAnswer)).toHaveBeenCalledWith(
      "user-1",
      true,
      expect.any(Number),
      expect.objectContaining({
        deckId: "deck-1",
        topicIds: [],
        folderIds: ["folder-1"],
      })
    );
    expect(vi.mocked(markDailyReviewCardComplete)).toHaveBeenCalledWith(
      "user-1",
      first,
      "required"
    );
    expect(vi.mocked(recordDailyReviewWeakAttempt)).not.toHaveBeenCalled();
    expect(currentCardId()).not.toBe(first);
  });

  it("records a weak attempt and requeues the card on Again", async () => {
    await click("Start Daily Review");
    const first = currentCardId()!;
    await flip();
    await click("Again");

    expect(vi.mocked(recordDailyReviewWeakAttempt)).toHaveBeenCalledWith(
      "user-1",
      first,
      expect.any(Number)
    );
    expect(vi.mocked(markDailyReviewCardComplete)).not.toHaveBeenCalled();
    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
      expect.objectContaining({ isCorrect: false })
    );

    // The missed card goes to the back of the queue, so the next card on
    // screen is the other one and the session does not shrink.
    expect(currentCardId()).toBe("card-2");
    expect(document.body.textContent).toContain("cards remaining");
  });

  it("stops requeueing once the attempt is parked, and marks the risk", async () => {
    vi.mocked(recordDailyReviewWeakAttempt).mockResolvedValue({
      attemptCount: 3,
      parked: true,
    });

    await click("Start Daily Review");
    const first = currentCardId()!;
    await flip();
    await click("Again");

    const parkedWrite = vi
      .mocked(updateCardAfterReview)
      .mock.calls.find(([, command]) =>
        Boolean(command.values?.memoryRiskOverrideDayKey)
      );
    expect(
      parkedWrite,
      "a parked card records tomorrow's risk override"
    ).toBeDefined();
    expect(parkedWrite![0]).toBe(first);
    expect(currentCardId()).toBe("card-2");
  });

  it("commits exactly once per rating", async () => {
    await click("Start Daily Review");
    await flip();
    await click("Good");
    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateCardAfterReview)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyGoalProgressForAnswer)).toHaveBeenCalledTimes(1);
  });
});

describe("the answer-first modes", () => {
  async function type(value: string) {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "#study-answer-entry"
    );
    expect(field, "expected an answer field").not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(field, value);
      field!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
  }

  it("defaults to Classic so nobody's review changes without asking", async () => {
    await click("Start Daily Review");
    expect(document.querySelector("#study-answer-entry")).toBeNull();
    expect(document.querySelector(".study-flashcard-face")).not.toBeNull();
  });

  it("asks for the answer once Type Answer is chosen", async () => {
    await click("Type Answer");
    await click("Start Daily Review");
    expect(document.querySelector("#study-answer-entry")).not.toBeNull();
    // The answer is not on screen while the question is being answered.
    expect(document.body.textContent).not.toContain(
      "The immediate energy carrier of the cell."
    );
  });

  it("commits Good and moves on for a clean answer", async () => {
    await click("Type Answer");
    await click("Start Daily Review");
    const first = currentCardId();
    await type("The immediate energy carrier of the cell.");
    await click("Check answer");

    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
      expect.objectContaining({ isCorrect: true })
    );
    expect(currentCardId()).not.toBe(first);
  });

  it("shows the answer before committing a miss, then requeues the card", async () => {
    await click("Type Answer");
    await click("Start Daily Review");
    const first = currentCardId()!;
    await type("something else entirely");
    await click("Check answer");

    // Still on the same card, with the answer now visible: a miss the student
    // never sees the answer to teaches nothing.
    expect(currentCardId()).toBe(first);
    expect(document.body.textContent).toContain(
      "The immediate energy carrier of the cell."
    );
    expect(vi.mocked(recordStudyReview)).not.toHaveBeenCalled();

    await click("Next card");
    expect(vi.mocked(recordDailyReviewWeakAttempt)).toHaveBeenCalled();
    expect(currentCardId()).toBe("card-2");
  });

  /*
   * Whether a card is worth sending to a model is decided by
   * `needsStudyAssetPreparation`, which has its own unit tests. These two are
   * about the wiring, which is the half that broke: the rule shipped correct
   * and unreferenced once already, and every test still passed.
   */
  it("spends nothing on a mode that has no use for a model", async () => {
    await click("Type Answer");
    await click("Start Daily Review");
    expect(currentCardId()).toBe("card-1");
    expect(vi.mocked(prepareStudyAssets)).not.toHaveBeenCalled();
  });

  it("prepares when the mode cannot be built without it", async () => {
    await click("Multiple Choice");
    await click("Start Daily Review");
    expect(vi.mocked(prepareStudyAssets)).toHaveBeenCalled();
  });

  it("remembers the chosen mode for next time", async () => {
    await click("Type Answer");
    expect(window.localStorage.getItem("jami:study-mode:user-1")).toBe(
      "type-answer"
    );
  });

  /*
   * Multiple choice was practice-only while its wrong options came from
   * whatever else was in the deck. These two say what replaced that: the
   * question is not offered at all unless the options were written for the
   * card, and when it is offered it counts like every other mode.
   */
  it("refuses a Multiple Choice session on a deck nobody has prepared", async () => {
    await click("Multiple Choice");
    await click("Start Daily Review");
    expect(currentCardId()).toBeUndefined();
    expect(document.body.textContent).toContain(
      "None of these cards can be studied that way yet"
    );
  });

  it("completes a due card once Jami has written the wrong answers", async () => {
    vi.mocked(loadStudyAssets).mockResolvedValue({
      "card-1": preparedAsset("card-1", [
        "The main store of genetic information.",
        "Where lipids are packaged for export.",
        "The site of photosynthesis in a plant.",
      ]),
      "card-2": preparedAsset("card-2", [
        "Where energy is released from glucose.",
        "Where waste is broken down.",
        "Where the cell is held together.",
      ]),
    });

    await click("Multiple Choice");
    await click("Start Daily Review");
    expect(currentCardId()).toBe("card-1");

    await chooseOption("The immediate energy carrier of the cell.");
    await click("Next card");

    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
      expect.objectContaining({ isCorrect: true })
    );
    expect(vi.mocked(markDailyReviewCardComplete)).toHaveBeenCalled();
    expect(currentCardId()).toBe("card-2");
  });
});

describe("a missed card comes round again", () => {
  it("sends it to the back of a Daily Review queue", async () => {
    await click("Start Daily Review");
    const first = currentCardId()!;
    await flip();
    await click("Again");
    // Not the same card straight back: there is no forgetting to be done when
    // the answer is still on screen.
    expect(currentCardId()).not.toBe(first);
    expect(currentCardId()).toBe("card-2");
  });

  it("leaves Classic outside Daily Review exactly as it was", async () => {
    // Focused Review has never requeued a missed card and does not start now:
    // the extraction and the new modes must not change what Classic does.
    await click("Choose decks or Topics");
    await click("Start Focused Review");
    const first = currentCardId()!;
    await flip();
    await click("Again");
    expect(currentCardId()).not.toBe(first);
    expect(vi.mocked(recordDailyReviewWeakAttempt)).not.toHaveBeenCalled();
  });
});

describe("Focused Review answers", () => {
  it("never writes an FSRS schedule, and reports itself as custom", async () => {
    await click("Choose decks or Topics");
    await click("Start Focused Review");
    await flip();
    await click("Hard");

    expect(vi.mocked(recordStudyReview)).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
      expect.objectContaining({ sessionKind: "custom" })
    );
    const [, command] = vi.mocked(updateCardAfterReview).mock.calls[0];
    expect(command.values).not.toHaveProperty("dueDate");
    expect(command.values).not.toHaveProperty("stability");
    // A struggle outside Daily Review still marks the card as at risk.
    expect(command.values?.memoryRiskOverrideDayKey).toEqual(expect.any(String));
    expect(command.increments?.customStruggleCount).toBe(1);
    expect(vi.mocked(markDailyReviewCardComplete)).not.toHaveBeenCalled();
  });
});

describe("Simple Study answers", () => {
  it("records a Simple Study result and touches neither FSRS nor Daily Review", async () => {
    await click("Start Simple Study");
    await flip();
    await click("Got it");

    expect(vi.mocked(recordSimpleStudyResult)).toHaveBeenCalledWith(
      expect.any(String),
      "correct",
      expect.any(Number)
    );
    expect(vi.mocked(updateCardAfterReview)).not.toHaveBeenCalled();
    expect(vi.mocked(recordStudyReview)).not.toHaveBeenCalled();
    expect(vi.mocked(markDailyReviewCardComplete)).not.toHaveBeenCalled();
  });

  it("offers two choices rather than the four-point scale", async () => {
    await click("Start Simple Study");
    await flip();
    expect(button("Got it")).toBeDefined();
    expect(button("Missed")).toBeDefined();
    expect(button("Hard")).toBeUndefined();
    expect(button("Easy")).toBeUndefined();
  });
});

describe("answering while offline", () => {
  it("queues the review locally instead of calling the services", async () => {
    await click("Start Daily Review");
    const first = currentCardId()!;

    const online = vi
      .spyOn(window.navigator, "onLine", "get")
      .mockReturnValue(false);

    await flip();
    await click("Good");

    expect(vi.mocked(recordStudyReview)).not.toHaveBeenCalled();
    expect(vi.mocked(updateCardAfterReview)).not.toHaveBeenCalled();
    expect(vi.mocked(markDailyReviewCardComplete)).not.toHaveBeenCalled();

    const queued = getOfflineQueuedReviews("user-1");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toEqual(
      expect.objectContaining({
        cardId: first,
        deckId: "deck-1",
        folderIds: ["folder-1"],
        rating: "good",
        isCorrect: true,
        sessionKind: "daily-required",
      })
    );
    expect(queued[0].cardUpdates).toEqual(
      expect.objectContaining({ dueDate: expect.any(Number) })
    );

    online.mockRestore();
  });
});
