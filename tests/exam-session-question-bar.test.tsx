// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExamSessionQuestionBar from "@/components/practice/ExamSessionQuestionBar";
import { examSessionQuestionRuns } from "@/lib/practice/exam-question-groups";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Question 7 on its own, then 3(a), 3(b) and 3(c): two questions, four parts. */
const paper = { board: "aqa" as const, year: 2023, series: "June" as const, paperReference: "8300/1H" };
const parts = [
  { id: "q7", provenance: { ...paper, questionNumber: "7" } },
  { id: "q3a", provenance: { ...paper, questionNumber: "3(a)" } },
  { id: "q3b", provenance: { ...paper, questionNumber: "3(b)" } },
  { id: "q3c", provenance: { ...paper, questionNumber: "3(c)" } },
];
const runs = examSessionQuestionRuns(parts);

const markedSeven = {
  id: "attempt-7",
  questionId: "q7",
  attemptNumber: 1,
  status: "marked",
  answerText: "",
  result: { awardedMarks: 2, maxMarks: 4 },
} as unknown as PublicExamAttempt;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(index: number, onGoTo = vi.fn()) {
  act(() => {
    root.render(
      <ExamSessionQuestionBar
        runs={runs}
        parts={parts}
        attempts={[markedSeven]}
        index={index}
        markedCount={1}
        canFinish
        finishing={false}
        onGoTo={onGoTo}
        onFinish={() => undefined}
      />
    );
  });
  return onGoTo;
}

const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === label
  );
  if (!found) throw new Error(`No "${label}" button.`);
  return found;
};

describe("the question bar", () => {
  it("numbers every question the way the answer sheet does, with no bare dots", () => {
    render(1);
    expect(container.textContent).not.toContain("•");
    // One chip for 7, and 3 carrying its own letters.
    expect(button("Question 7, marked 2/4").textContent).toBe("7");
    expect(button("Question 3(b), not started").textContent).toBe("b");
    // It no longer counts "Question 1 of 2" beside chips numbered by the paper.
    expect(container.textContent).not.toMatch(/Question \d+ of/);
    expect(container.textContent).toContain("1 of 2 marked");
  });

  it("says what each colour means in words", () => {
    render(0);
    expect(button("Question 7, marked 2/4").getAttribute("title")).toBe(
      "Question 7, marked 2/4"
    );
    expect(button("Question 3(a), not started").getAttribute("title")).toBe(
      "Question 3(a), not started"
    );
  });

  it("marks where you are and steps through the parts in order", () => {
    const onGoTo = render(2);
    expect(button("Question 3(b), not started").getAttribute("aria-current")).toBe("step");

    act(() => button("Next").click());
    expect(onGoTo).toHaveBeenLastCalledWith(3);
    act(() => button("Previous").click());
    expect(onGoTo).toHaveBeenLastCalledWith(1);
  });

  it("stops at either end", () => {
    render(0);
    expect(button("Previous").hasAttribute("disabled")).toBe(true);
    render(3);
    expect(button("Next").hasAttribute("disabled")).toBe(true);
  });
});
