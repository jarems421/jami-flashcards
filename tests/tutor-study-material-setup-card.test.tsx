// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorStudyMaterialSetupCard from "@/components/ai/TutorStudyMaterialSetupCard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Tutor's setup card", () => {
  it("makes only once there is a topic, with what the student chose", () => {
    const onMake = vi.fn();
    act(() => {
      root.render(
        <TutorStudyMaterialSetupCard
          setup={{ kind: "flashcards", kinds: ["flashcards", "practice"], topics: ["Osmosis", "Enzymes"] }}
          onMake={onMake}
        />
      );
    });

    // Nothing to make it on yet.
    expect(button("Make 10 flashcards").disabled).toBe(true);

    act(() => button("Osmosis").click());
    const [, hard] = [...container.querySelectorAll("input")];
    type(hard!, "which way water moves");
    act(() => button("Practice set").click());
    act(() => button("8").click());
    act(() => button("Make a 8-question set").click());

    expect(onMake).toHaveBeenCalledWith("practice", {
      focus: "Osmosis",
      count: 8,
      struggle: "which way water moves",
    });
  });

  it("takes a topic the student types when none of Tutor's fit", () => {
    const onMake = vi.fn();
    act(() => {
      root.render(<TutorStudyMaterialSetupCard setup={{ kind: "flashcards", kinds: ["flashcards"], topics: [] }} onMake={onMake} />);
    });
    // Only flashcards on offer, so there is nothing to switch between.
    expect(container.querySelector("[aria-label='What to make']")).toBeNull();
    const [own] = [...container.querySelectorAll("input")];
    type(own!, "Respiration");
    act(() => button("Make 10 flashcards").click());
    expect(onMake).toHaveBeenCalledWith("flashcards", { focus: "Respiration", count: 10 });
  });
});
