// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GoalsPage from "@/app/dashboard/goals/page";
import { getGoalHistoryPage } from "@/services/study/goals";

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "user-1" } }),
}));

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    loading: false,
    reload: vi.fn().mockResolvedValue({ status: "applied" }),
  }),
}));

vi.mock("@/services/study/decks", () => ({
  getDecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/study/topics", () => ({
  getActiveTopics: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/study/folders", () => ({
  getActiveStudyFolders: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/study/goals", () => ({
  createGoal: vi.fn(),
  getActiveGoalsWithCurrentStatuses: vi.fn().mockResolvedValue([]),
  getCompletedGoalCount: vi.fn().mockResolvedValue(0),
  getGoalHistoryPage: vi.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
  }),
  updateGoal: vi.fn(),
}));

vi.mock("@/services/constellation/constellations", () => ({
  ensureConstellationSetup: vi.fn().mockResolvedValue([]),
}));

const globalStylesSource = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root.render(<GoalsPage />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

function inputForLabel(label: string) {
  const labelElement = [...document.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  return labelElement?.htmlFor
    ? document.getElementById(labelElement.htmlFor)
    : null;
}

async function openComposer() {
  const trigger = button("New goal");
  expect(trigger).toBeDefined();
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("goals deadline layout", () => {
  it("renders native date and time controls as full-field hit targets", async () => {
    await openComposer();

    const dateInput = inputForLabel("Finish by date");
    const timeInput = inputForLabel("Finish by time");

    expect(dateInput).toBeInstanceOf(HTMLInputElement);
    expect(timeInput).toBeInstanceOf(HTMLInputElement);
    expect(dateInput?.getAttribute("type")).toBe("date");
    expect(timeInput?.getAttribute("type")).toBe("time");
    expect(dateInput?.className).toContain("goal-deadline-native");
    expect(dateInput?.className).toContain("absolute");
    expect(dateInput?.className).toContain("inset-0");
    expect(dateInput?.className).not.toContain("goal-deadline-input");
  });

  it("renders the composer through its container-query layout contract", async () => {
    await openComposer();

    expect(document.querySelector(".goal-form-layout .goal-form-grid")).not.toBeNull();
    // This is an intentional stylesheet-policy assertion: the rendered class
    // contract above must be paired with the responsive container rule.
    expect(globalStylesSource).toContain("container: goal-form / inline-size");
    expect(globalStylesSource).toContain(
      "@container goal-form (min-width: 34rem)"
    );
  });

  it("loads goal history only when the student opens it", async () => {
    expect(getGoalHistoryPage).not.toHaveBeenCalled();

    await act(async () => {
      button("Show goal history")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(getGoalHistoryPage).toHaveBeenCalledWith("user-1", {
      cursor: null,
      pageSize: 30,
    });
    expect(document.body.textContent).toContain("No past goals yet");
  });
});
