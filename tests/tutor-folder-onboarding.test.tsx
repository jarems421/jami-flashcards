// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorFolderOnboarding from "@/components/ai/TutorFolderOnboarding";

/**
 * The one-time walk through writing a subject's notes.
 *
 * Worth testing carefully because a student sees it once: if it asks the wrong
 * thing, loses an answer, or saves something they did not agree to, there is no
 * second run to put it right.
 */

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function button(text: string) {
  return [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.trim().includes(text)
  ) as HTMLButtonElement | undefined;
}

function field() {
  return container.querySelector("input, textarea") as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
}

async function type(value: string) {
  const element = field();
  if (!element) throw new Error("No field on screen.");
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(text: string) {
  const target = button(text);
  if (!target) throw new Error(`No button matching "${text}".`);
  await act(async () => target.click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function setup(onSave = vi.fn().mockResolvedValue(true), suggested = "") {
  return {
    onSave,
    onSkip: vi.fn(),
    node: (
      <TutorFolderOnboarding
        folderName="Biology"
        suggestedCourse={suggested}
        saving={false}
        onSave={onSave}
        onSkip={vi.fn()}
      />
    ),
  };
}

describe("the subject notes onboarding", () => {
  it("opens by naming the folder and asking the first question only", async () => {
    await render(setup().node);

    expect(container.textContent).toContain("Let’s set up");
    expect(container.textContent).toContain("Biology");
    expect(container.textContent).toContain("Which course is this for?");
    // The later questions are not on screen yet; that is what makes it a
    // conversation rather than a form.
    expect(container.textContent).not.toContain("What should I focus on?");
    expect(container.textContent).not.toContain("Anything I should avoid?");
  });

  it("prefills only what is already known", async () => {
    await render(setup(vi.fn(), "AQA A-level Biology").node);
    expect(field()?.value).toBe("AQA A-level Biology");
  });

  it("asks the questions one at a time and reads each answer back", async () => {
    await render(setup().node);

    await type("AQA A-level Biology");
    await click("Next");
    expect(container.textContent).toContain("AQA A-level Biology");
    expect(container.textContent).toContain("What should I focus on?");

    await type("Specification wording.");
    await click("Next");
    expect(container.textContent).toContain("Anything I should avoid?");
  });

  it("lets a question be passed over without an answer", async () => {
    await render(setup().node);
    expect(button("Skip this one")).toBeDefined();
  });

  it("shows the write-up under clear labels before anything is saved", async () => {
    const { node, onSave } = setup();
    await render(node);

    await type("AQA A-level Biology");
    await click("Next");
    await type("Specification wording.");
    await click("Next");
    await type("No full answers up front.");
    await click("Next");

    expect(container.textContent).toContain("Here's what I've got for Biology");
    expect(container.textContent).toContain("Course");
    expect(container.textContent).toContain("Focus on");
    expect(container.textContent).toContain("Avoid");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a document built from the answers, then hands over warmly", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    await render(setup(onSave).node);

    await type("AQA A-level Biology");
    await click("Next");
    await type("Specification wording.");
    await click("Next");
    await click("Skip this one");
    await click("Save these notes");

    const saved = onSave.mock.calls[0][0] as string;
    expect(saved).toContain("## Course");
    expect(saved).toContain("AQA A-level Biology");
    expect(saved).toContain("## Focus on");
    // Nothing was said here, so the heading is left out rather than left empty.
    expect(saved).not.toContain("## Avoid");

    expect(container.textContent).toContain("Saved.");
    expect(container.textContent).toContain("Get creative");
  });

  it("cannot save an empty set of notes", async () => {
    await render(setup().node);

    await click("Skip this one");
    await click("Skip this one");
    await click("Skip this one");

    expect(container.textContent).toContain("You haven't given me anything yet");
    expect(button("Save these notes")?.disabled).toBe(true);
  });

  it("lets the student go back and change an answer", async () => {
    await render(setup().node);

    await type("AQA A-level Biology");
    await click("Next");
    await click("Skip this one");
    await click("Skip this one");

    await click("Change something");
    expect(container.textContent).toContain("Which course is this for?");
    expect(field()?.value).toBe("AQA A-level Biology");
  });
});
