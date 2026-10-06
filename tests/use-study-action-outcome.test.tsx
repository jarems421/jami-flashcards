// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudyActionOutcome } from "@/hooks/useStudyActionOutcome";

vi.mock("@/services/learning/study-action-events", () => ({
  noteStudyActionOutcomeById: vi.fn(),
}));
vi.mock("@/lib/learning/mission-handoff", () => ({
  noteMissionCompleted: vi.fn(),
}));

const { noteStudyActionOutcomeById } = await import("@/services/learning/study-action-events");
const { noteMissionCompleted } = await import("@/lib/learning/mission-handoff");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = {
  actionId: string | null;
  sessionOpen: boolean;
  done: boolean;
  reviewedCards: number;
};

let container: HTMLDivElement;
let root: Root;
let noteLeft: () => void = () => {};

function Harness(props: Props) {
  const outcome = useStudyActionOutcome({ userId: "user-1", studyDayKey: "2026-10-06", ...props });
  useEffect(() => {
    noteLeft = outcome.noteLeft;
  });
  return null;
}

function render(props: Props) {
  act(() => root.render(<Harness {...props} />));
}

function outcomes() {
  return vi.mocked(noteStudyActionOutcomeById).mock.calls.map(([, actionId, outcome]) => `${actionId}:${outcome}`);
}

const inProgress = { actionId: "action-1", sessionOpen: true, done: false, reviewedCards: 2 };
const finished = { actionId: "action-1", sessionOpen: false, done: true, reviewedCards: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useStudyActionOutcome", () => {
  it("records a finished session as completed, and never as abandoned", () => {
    render(inProgress);
    render(finished);
    act(() => root.unmount());
    root = createRoot(container);

    expect(outcomes()).toEqual(["action-1:completed"]);
    expect(vi.mocked(noteMissionCompleted)).toHaveBeenCalledWith("action-1", 3);
  });

  it("records leaving the page mid-session as abandoned", () => {
    render(inProgress);
    act(() => root.unmount());
    root = createRoot(container);

    expect(outcomes()).toEqual(["action-1:abandoned"]);
  });

  it("records the tab being hidden mid-session, once", () => {
    render(inProgress);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(outcomes()).toEqual(["action-1:abandoned"]);
  });

  it("records ending the session through the page as abandoned", () => {
    render(inProgress);
    act(() => noteLeft());
    render({ ...inProgress, sessionOpen: false });

    expect(outcomes()).toEqual(["action-1:abandoned"]);
  });

  it("does not count arriving at an empty queue as doing the work", () => {
    render({ ...finished, reviewedCards: 0 });

    expect(outcomes()).toEqual([]);
  });

  it("records nothing for a session no recommendation opened", () => {
    render({ ...inProgress, actionId: null });
    render({ ...finished, actionId: null });
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(outcomes()).toEqual([]);
  });
});
