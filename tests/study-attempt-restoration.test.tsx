// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudyExerciseStage from "@/components/study/StudyExerciseStage";
import type { ResolvedExercise } from "@/lib/study/study-modes";
import type { PresentationViewState } from "@/lib/study/presentation-state";
import type { Card } from "@/lib/study/cards";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const card: Card = { id: "c", userId: "u", deckId: "d", front: "Describe energy transfer.", back: "Energy moves between different stores in a closed system.", tags: [], createdAt: 1 };
const gap = { id: "g1", start: 0, end: 6, answer: "Energy", acceptedAnswers: ["energy"], concept: "energy" };
const exercise: ResolvedExercise = { cardId: "c", presentationId: "session:1:c", cardContentHash: "hash", mode: "gap-fill", prompt: card.front, expectedAnswer: "Energy", gaps: [gap], cloze: gap, variantId: "v1", markingSettings: { acceptedAnswers: ["whole-card alias"] }, source: "cached-ai" };
let root: Root, host: HTMLDivElement;
let saved: PresentationViewState;
let draft: string | Record<string, string>;
const semantic = vi.fn();
const commit = vi.fn();
const answered = vi.fn();
async function render(key = "first", supplied = exercise) {
  await act(async () => root.render(<StudyExerciseStage key={key} card={card} exercise={supplied} savingRating={null} onCommit={commit} onModeAnswered={answered} onSemanticCheck={semantic} viewState={saved} onViewStateChange={(state) => { saved = state; }} draftResponse={draft} onDraftChange={(value) => { draft = value; }} />));
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text));
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function type(value: string) {
  const input = host.querySelector<HTMLInputElement>("#study-answer-entry")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  saved = {}; draft = ""; vi.clearAllMocks(); semantic.mockResolvedValue(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("sends a single gap's identity and refuses whole-card aliases locally", async () => {
  await render(); await type("whole-card alias"); await click("Check answer");
  expect(semantic).toHaveBeenCalledWith("whole-card alias", { g1: "whole-card alias" });
  expect(saved.result?.verdict).toBe("needs-self-grade");
});
it("restores the marked answer after refresh without marking or recording it again", async () => {
  await render(); await type("energy"); await click("Check answer");
  expect(saved.result?.verdict).toBe("correct");
  await render("refreshed");
  expect(host.textContent).toContain("You wrote: energy");
  expect(host.querySelector<HTMLInputElement>("#study-answer-entry")?.disabled).toBe(true);
  expect(answered).toHaveBeenCalledTimes(1);
  expect(semantic).not.toHaveBeenCalled();
});
it("keeps a hint attached to a restored correct response", async () => {
  saved = { hintUsed: true, phase: "marked", result: { verdict: "correct", shape: "short" } }; draft = "energy";
  await render();
  expect(host.textContent).not.toContain("Next card");
  expect(commit).not.toHaveBeenCalled();
});
it("restores MCQ selection and its revealed explanation", async () => {
  const mcq: ResolvedExercise = { ...exercise, mode: "multiple-choice", mcq: { options: ["Energy", "Power", "Force", "Mass"].map((text, index) => ({ id: `opt-${index}`, text })), correctOptionId: "opt-0", explanations: { "opt-1": "Power is the rate of energy transfer." } } };
  await render("mcq", mcq); await click("2");
  expect(saved.chosenId).toBe("opt-1");
  await render("refreshed", mcq);
  expect(host.textContent).toContain("Power is the rate of energy transfer.");
  expect(host.querySelector('[aria-checked="true"]')?.textContent).toContain("Power");
});
