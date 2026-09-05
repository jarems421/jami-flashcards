// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorStudyProfileForm from "@/components/ai/TutorStudyProfileForm";
import {
  formatStudySubjects,
  normalizeStudySubjects,
  MAX_STUDY_SUBJECTS,
} from "@/lib/profile/study-subjects";
import { studyLevelNeedsSubjects } from "@/lib/profile/study-level";

/**
 * The level a student is working at, and the courses that make it mean
 * something.
 *
 * The rule under test is the one a student meets: from A level upwards the form
 * will not save until they have named at least one subject, because "A level"
 * on its own tells a tutor almost nothing about what to assume.
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

function subjectField() {
  return container.querySelector("#tutor-study-subject") as HTMLInputElement | null;
}

async function selectLevel(value: string) {
  const select = container.querySelector("select") as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )?.set;
  setter?.call(select, value);
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function typeSubject(value: string) {
  const field = subjectField();
  if (!field) throw new Error("No subject field on screen.");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(field, value);
  await act(async () => {
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter() {
  const field = subjectField();
  if (!field) throw new Error("No subject field on screen.");
  await act(async () => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  });
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

describe("which levels need subjects", () => {
  it("asks from A level upwards and not below it", () => {
    expect(studyLevelNeedsSubjects("early-secondary")).toBe(false);
    expect(studyLevelNeedsSubjects("gcse-equivalent")).toBe(false);
    expect(studyLevelNeedsSubjects("post-16-equivalent")).toBe(true);
    expect(studyLevelNeedsSubjects("undergraduate")).toBe(true);
    expect(studyLevelNeedsSubjects("postgraduate")).toBe(true);
    expect(studyLevelNeedsSubjects("professional-other")).toBe(true);
    expect(studyLevelNeedsSubjects(null)).toBe(false);
  });
});

describe("storing a list of subjects", () => {
  it("drops blanks, collapses whitespace and keeps the first spelling", () => {
    expect(
      normalizeStudySubjects(["  Further   Maths ", "", "maths", "Maths", 7])
    ).toEqual(["Further Maths", "maths"]);
  });

  it("caps the list rather than letting it grow into the prompt", () => {
    const many = Array.from({ length: 30 }, (_, index) => `Subject ${index}`);
    expect(normalizeStudySubjects(many)).toHaveLength(MAX_STUDY_SUBJECTS);
  });

  it("reads as a sentence, because that is where it ends up", () => {
    expect(formatStudySubjects(["Maths"])).toBe("Maths");
    expect(formatStudySubjects(["Maths", "Physics", "Chemistry"])).toBe(
      "Maths, Physics and Chemistry"
    );
  });
});

describe("the study profile form", () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const onSave = vi.fn().mockResolvedValue(true);
    return {
      onSave,
      node: (
        <TutorStudyProfileForm
          studyLevel={null}
          studySubjects={[]}
          saving={false}
          onSave={onSave}
          {...overrides}
        />
      ),
    };
  }

  it("does not ask a GCSE student for subjects it would not use", async () => {
    const { node, onSave } = setup();
    await render(node);
    await selectLevel("gcse-equivalent");

    expect(subjectField()).toBeNull();

    await act(async () => button("Save")?.click());
    expect(onSave).toHaveBeenCalledWith({
      studyLevel: "gcse-equivalent",
      studySubjects: [],
    });
  });

  it("will not save an A level with no subjects behind it", async () => {
    const { node, onSave } = setup();
    await render(node);
    await selectLevel("post-16-equivalent");

    expect(subjectField()).not.toBeNull();
    expect(button("Save")?.disabled).toBe(true);
    expect(container.textContent).toContain("Add at least one");

    await typeSubject("Maths");
    await pressEnter();

    expect(button("Save")?.disabled).toBe(false);
    await act(async () => button("Save")?.click());
    expect(onSave).toHaveBeenCalledWith({
      studyLevel: "post-16-equivalent",
      studySubjects: ["Maths"],
    });
  });

  it("adds a subject once however many times it is typed", async () => {
    const { node } = setup({
      studyLevel: "undergraduate",
      studySubjects: ["Physics"],
    });
    await render(node);

    await typeSubject("physics");
    await act(async () => button("Add")?.click());

    expect(
      [...container.querySelectorAll("li")].map((entry) =>
        entry.textContent?.trim()
      )
    ).toEqual(["Physics"]);
  });

  it("lets a subject be taken off the list", async () => {
    const { node } = setup({
      studyLevel: "undergraduate",
      studySubjects: ["Physics", "Maths"],
    });
    await render(node);

    const remove = container.querySelector(
      '[aria-label="Remove Physics"]'
    ) as HTMLButtonElement;
    await act(async () => remove.click());

    expect(container.textContent).not.toContain("Physics");
    expect(container.textContent).toContain("Maths");
  });

  it("keeps subjects editable after a drop to a level that does not need them", async () => {
    // The list survives a level change on purpose, and the status chip keeps
    // showing it, so hiding the only way to edit it would be a dead end.
    const { node } = setup({
      studyLevel: "undergraduate",
      studySubjects: ["Physics"],
    });
    await render(node);
    await selectLevel("gcse-equivalent");

    expect(subjectField()).not.toBeNull();
    expect(container.textContent).toContain("(optional)");
    expect(button("Save")?.disabled).toBe(false);
  });

  it("says when a folder is overriding the level being edited", async () => {
    const { node } = setup({
      studyLevel: "gcse-equivalent",
      folderLevel: "undergraduate",
      folderName: "Biology",
    });
    await render(node);

    expect(container.textContent).toContain("Biology overrides this with");
    expect(container.textContent).toContain("University");
  });
});
