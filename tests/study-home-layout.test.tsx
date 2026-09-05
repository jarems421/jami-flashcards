// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyPage from "@/app/dashboard/study/page";

const fixtures = vi.hoisted(() => {
  const card = {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "What is ATP?",
    back: "The cell's immediate energy carrier.",
    createdAt: 1,
    dueDate: 0,
    tags: [],
    topicIds: [],
  };

  return {
    card,
    dailyReviewState: {
      id: "daily-review",
      studyDayKey: "2026-08-01",
      generatedAt: 1,
      requiredCardIds: [card.id],
      optionalCardIds: [],
      carryoverRequiredCardIds: [card.id],
      completedRequiredCardIds: [],
      completedOptionalCardIds: [],
      parkedRequiredCardIds: [],
      requiredRetryCounts: {},
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
  markDailyReviewCardComplete: vi.fn(),
  recordDailyReviewWeakAttempt: vi.fn(),
}));

vi.mock("@/services/study/cards", () => ({
  loadUserCards: vi.fn().mockResolvedValue([fixtures.card]),
  recordSimpleStudyResult: vi.fn(),
  updateCardAfterReview: vi.fn(),
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
      folderIds: [],
    },
  ]),
}));

vi.mock("@/services/study/topics", () => ({
  getActiveTopics: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/study/session", () => ({
  closeRemoteStudySession: vi.fn().mockResolvedValue(true),
  loadRemoteActiveStudySession: vi.fn().mockResolvedValue({
    session: null,
    foundRemoteSession: false,
  }),
  saveRemoteActiveStudySession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/study/offline", () => ({
  syncOfflineStudyReviews: vi.fn().mockResolvedValue({ synced: 0, remaining: 0 }),
}));

vi.mock("@/services/study/goals", () => ({
  applyGoalProgressForAnswer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/study/activity", () => ({
  recordStudyReview: vi.fn().mockResolvedValue(undefined),
}));

let container: HTMLDivElement;
let root: Root;

async function flushPageLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root.render(<StudyPage />);
  });
  await flushPageLoad();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

describe("Learn home layout", () => {
  it("renders one primary review surface followed by compact alternative modes", () => {
    expect(document.querySelector("h1")?.textContent).toContain("Learn");
    expect(document.body.textContent).toContain("Continue unfinished review");
    expect(document.body.textContent).toContain("Other ways to study");
    expect(document.body.textContent).toContain("Focused Review");
    expect(document.body.textContent).toContain("Simple Study");

    const dailyAction = button("Continue unfinished review");
    const alternatives = document.querySelector("#other-study-heading");
    expect(dailyAction).toBeDefined();
    expect(alternatives).not.toBeNull();
    expect(
      dailyAction!.compareDocumentPosition(alternatives!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("opens the Focused Review builder through its accessible disclosure", async () => {
    const trigger = button("Choose decks or Topics");
    expect(trigger).toBeDefined();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-controls")).toBe(
      "focused-review-builder"
    );
    expect(document.querySelector("#focused-review-builder")).toBeNull();

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const builder = document.querySelector("#focused-review-builder");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(builder).not.toBeNull();
    expect(
      builder?.querySelector('[role="group"][aria-label="Focused Review filter type"]')
    ).not.toBeNull();
    expect(builder?.querySelector('button[aria-pressed="true"]')?.textContent).toContain(
      "Decks"
    );
    expect(builder?.querySelector("label")?.textContent).toContain(
      "Search decks"
    );
  });

  it("opens the builder inside the Focused Review card rather than after the grid", async () => {
    const trigger = button("Choose decks or Topics");
    const card = trigger!.closest(".app-panel");
    expect(card).not.toBeNull();

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The setup used to render after the whole "Other ways to study" grid,
    // which put it below the Simple Study card it has nothing to do with.
    const builder = document.querySelector("#focused-review-builder");
    expect(builder).not.toBeNull();
    expect(card!.contains(builder!)).toBe(true);

    const simpleStudyCard = button("Start Simple Study")?.closest(".app-panel");
    expect(simpleStudyCard).not.toBeNull();
    expect(simpleStudyCard!.contains(builder!)).toBe(false);
  });
});

describe("How to study", () => {
  function pickerTrigger(surface: string) {
    return document.querySelector<HTMLButtonElement>(
      `[data-study-mode-surface="${surface}"] button`
    );
  }

  it("offers the modes on every way to study, starting from Classic", async () => {
    await act(async () => {
      button("Choose decks or Topics")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    for (const surface of ["daily", "focused", "simple"]) {
      const trigger = pickerTrigger(surface);
      expect(trigger, surface).not.toBeNull();
      expect(trigger!.getAttribute("aria-expanded")).toBe("false");
      expect(trigger!.textContent).toContain("Classic");
    }

    // The focused picker is the one inside the builder, so opening it proves
    // the modes travel with the session being set up.
    expect(
      document
        .querySelector("#focused-review-builder")
        ?.contains(pickerTrigger("focused")!)
    ).toBe(true);
  });

  it("keeps the other modes and their explanations one click away", async () => {
    const trigger = pickerTrigger("daily");
    expect(document.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const list = document.querySelector('[role="listbox"]');
    expect(trigger!.getAttribute("aria-expanded")).toBe("true");
    expect(list).not.toBeNull();

    const options = [...list!.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(5);
    expect(list!.textContent).toContain("Smart Mix");
    expect(list!.textContent).toContain("Multiple Choice");
    // Every option carries its own line on what it does, which is the reason
    // this is a list rather than a row of bare pills.
    expect(list!.textContent).toContain("Write the answer from memory");
    expect(
      options.find((option) => option.getAttribute("aria-selected") === "true")
        ?.textContent
    ).toContain("Classic");

    await act(async () => {
      options
        .find((option) => option.textContent?.startsWith("Smart Mix"))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(pickerTrigger("daily")!.textContent).toContain("Smart Mix");
    // Chosen once, everywhere: the mode is a student preference, not a
    // per-card setting hidden on one of three surfaces.
    expect(pickerTrigger("simple")!.textContent).toContain("Smart Mix");
  });
});
