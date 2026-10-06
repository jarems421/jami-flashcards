// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExamAnswerDrafts } from "@/hooks/useExamAnswerDrafts";

vi.mock("@/services/study/exam-practice", () => ({
  saveExamAnswerDraft: vi.fn(async () => undefined),
}));

const { saveExamAnswerDraft } = await import("@/services/study/exam-practice");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Drafts = ReturnType<typeof useExamAnswerDrafts>;

let container: HTMLDivElement;
let root: Root;
let drafts: Drafts;

function Harness() {
  const value = useExamAnswerDrafts({ sessionId: "s1" });
  useEffect(() => {
    drafts = value;
  });
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useExamAnswerDrafts", () => {
  it("saves a draft once typing pauses, and says so", async () => {
    act(() => drafts.handleDraft("a1", "First", ""));
    expect(vi.mocked(saveExamAnswerDraft)).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(vi.mocked(saveExamAnswerDraft)).toHaveBeenCalledWith("s1", "a1", "First", undefined);
    expect(drafts.saveState).toBe("saved");
  });

  it("sends what was typed during a slow save once it lands, never out of order", async () => {
    let finishFirst: () => void = () => undefined;
    vi.mocked(saveExamAnswerDraft).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve({});
        })
    );

    act(() => drafts.handleDraft("a1", "First", ""));
    let flushing: Promise<void> = Promise.resolve();
    act(() => {
      flushing = drafts.flushDrafts();
    });
    act(() => drafts.handleDraft("a1", "First and second", ""));
    await act(async () => {
      await drafts.flushDrafts();
    });
    expect(vi.mocked(saveExamAnswerDraft)).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst();
      await flushing;
    });
    expect(vi.mocked(saveExamAnswerDraft).mock.calls.map((call) => call[2])).toEqual(["First", "First and second"]);
  });

  it("keeps a draft that failed to save, and sends it with the next one", async () => {
    vi.mocked(saveExamAnswerDraft).mockRejectedValueOnce(new Error("offline"));
    act(() => drafts.handleDraft("a1", "Kept", ""));
    await act(async () => {
      await drafts.flushDrafts();
    });
    expect(drafts.saveState).toBe("failed");

    await act(async () => {
      await drafts.flushDrafts();
    });
    expect(vi.mocked(saveExamAnswerDraft)).toHaveBeenLastCalledWith("s1", "a1", "Kept", undefined);
    expect(drafts.saveState).toBe("saved");
  });

  it("knows whether an answer is typed, from the draft before what is stored", () => {
    expect(drafts.hasTypedText("a1", "Stored answer")).toBe(true);
    act(() => drafts.handleDraft("a1", "", "Stored answer"));
    expect(drafts.hasTypedText("a1", "Stored answer")).toBe(false);
    expect(drafts.readDraft("a1")).toBe("");
  });
});
