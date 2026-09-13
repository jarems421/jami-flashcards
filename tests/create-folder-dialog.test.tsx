// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateFolderDialog from "@/components/workspace/CreateFolderDialog";
import type { ExamCourseOption } from "@/lib/practice/exam-course-form";

const createStudyFolder = vi.fn();
const getExamCourseOptions = vi.fn();

vi.mock("@/services/study/folders", () => ({
  createStudyFolder: (...a: unknown[]) => createStudyFolder(...a),
}));

vi.mock("@/services/study/exam-practice", () => ({
  getExamCourseOptions: (...a: unknown[]) => getExamCourseOptions(...a),
}));

const GCSE_MATHS: ExamCourseOption = {
  specificationId: "8300",
  specificationTitle: "Mathematics",
  qualification: "gcse",
  qualificationLabel: "GCSE",
  componentIds: ["8300/1F", "8300/1H"],
  tiers: [
    { name: "Foundation", componentIds: ["8300/1F"] },
    { name: "Higher", componentIds: ["8300/1H"] },
  ],
};

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onCreated = vi.fn();

async function render(open = true) {
  await act(async () => {
    root.render(
      <CreateFolderDialog
        open={open}
        userId="user-1"
        onClose={onClose}
        onCreated={onCreated}
      />
    );
  });
}

const form = () => document.querySelector("form");
/** The Input primitive renders no explicit type attribute. */
const nameField = () =>
  document.querySelector<HTMLInputElement>("[data-dialog-autofocus='true']");
const submitButton = () =>
  document.querySelector<HTMLButtonElement>("button[type=submit]");

function labelled<Element extends HTMLElement>(label: string) {
  const labelElement = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === label
  );
  return labelElement
    ? (document.getElementById(labelElement.htmlFor) as Element | null)
    : null;
}

function radio(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("[role=radio]")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

function type(field: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function choose(field: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    form()?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );
  });
}

beforeEach(() => {
  createStudyFolder.mockReset().mockResolvedValue({ id: "folder-1" });
  getExamCourseOptions.mockReset().mockResolvedValue([GCSE_MATHS]);
  onClose.mockClear();
  onCreated.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
});

describe("CreateFolderDialog", () => {
  it("renders nothing while closed", async () => {
    await render(false);
    expect(form()).toBeNull();
  });

  it("will not submit an empty name", async () => {
    await render();
    await submit();
    expect(createStudyFolder).not.toHaveBeenCalled();
    // The rule only appears once the student has tried, not on first sight.
    expect(document.body.textContent).toMatch(/name/i);
  });

  it("keeps submit disabled until the name is valid", async () => {
    await render();
    expect(submitButton()?.disabled).toBe(true);

    type(nameField()!, "Physics");
    expect(submitButton()?.disabled).toBe(false);
  });

  it("creates the folder and reports it back", async () => {
    await render();
    type(nameField()!, "Physics");
    await submit();

    expect(createStudyFolder).toHaveBeenCalledTimes(1);
    expect(createStudyFolder.mock.calls[0]?.[0]).toBe("user-1");
    expect(createStudyFolder.mock.calls[0]?.[1]).toMatchObject({
      name: "Physics",
    });
    // Nothing chosen means nothing written, not an empty course.
    expect(createStudyFolder.mock.calls[0]?.[1]).not.toHaveProperty("studyLevel");
    expect(createStudyFolder.mock.calls[0]?.[1]).not.toHaveProperty("examCourse");
    expect(onCreated).toHaveBeenCalledWith({ id: "folder-1" });
  });

  it("saves the level, course and tier chosen while creating", async () => {
    await render();
    type(nameField()!, "Maths");
    expect(labelled("Exam board")).toBeNull();

    choose(labelled<HTMLSelectElement>("Study level")!, "gcse-equivalent");
    expect(
      [...labelled<HTMLSelectElement>("Exam board")!.options].map((option) => option.textContent)
    ).toEqual(["Choose board", "AQA", "OCR", "Pearson Edexcel"]);
    choose(labelled<HTMLSelectElement>("Exam board")!, "aqa");
    await act(async () => {});
    expect(getExamCourseOptions).toHaveBeenCalledWith({ board: "aqa" });

    const course = labelled<HTMLSelectElement>("Course")!;
    // Named the way a student says it: no code, no qualification twice.
    expect([...course.options].map((option) => option.textContent)).toContain("GCSE Maths");
    choose(course, "8300");
    // A tiered course is not a course until the tier is chosen.
    expect(submitButton()?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose your tier");

    await act(async () => {
      radio("Higher")!.click();
    });
    expect(submitButton()?.disabled).toBe(false);
    expect(document.body.textContent).toContain("AQA · GCSE Maths · Higher");

    await submit();
    expect(createStudyFolder.mock.calls[0]?.[1]).toMatchObject({
      name: "Maths",
      studyLevel: "gcse-equivalent",
      examCourse: {
        board: "aqa",
        qualification: "gcse",
        specificationId: "8300",
        specificationTitle: "Mathematics",
        tier: "Higher",
        componentIds: ["8300/1H"],
      },
    });
  });

  it("does not ask for an exam course outside school levels", async () => {
    await render();
    choose(labelled<HTMLSelectElement>("Study level")!, "undergraduate");
    expect(labelled("Exam board")).toBeNull();

    type(nameField()!, "Law");
    await submit();
    expect(createStudyFolder.mock.calls[0]?.[1]).toMatchObject({
      name: "Law",
      studyLevel: "undergraduate",
    });
    expect(createStudyFolder.mock.calls[0]?.[1]).not.toHaveProperty("examCourse");
  });

  it("cannot be submitted twice from the button", async () => {
    let release: (value: unknown) => void = () => undefined;
    createStudyFolder.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    type(nameField()!, "Physics");

    // The submit button sits in the sticky footer, outside the fieldset, so
    // it is its own disabled state that stops a second press.
    await act(async () => {
      submitButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      submitButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createStudyFolder).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ id: "folder-1" });
    });
  });

  it("locks the form while saving", async () => {
    let release: (value: unknown) => void = () => undefined;
    createStudyFolder.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      })
    );
    await render();
    type(nameField()!, "Physics");
    await submit();

    expect(document.querySelector("fieldset")?.disabled).toBe(true);

    await act(async () => {
      release({ id: "folder-1" });
    });
  });

  it("surfaces a failure and leaves the dialog open to retry", async () => {
    createStudyFolder.mockRejectedValue(new Error("Folder already exists."));
    await render();
    type(nameField()!, "Physics");
    await submit();

    expect(document.body.textContent).toContain("Folder already exists.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(form()).not.toBeNull();
  });
});
