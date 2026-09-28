// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanDraftPreview from "@/components/planning/PlanDraftPreview";
import { describeAssistantPlanDraft } from "@/lib/ai/assistant-plan";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import type { RevisionPlanDraft } from "@/lib/planning/types";

/**
 * The plan being built, while it is being built.
 *
 * The panel exists so a student can watch the thing take shape, section by
 * section, as Jami's questions are answered -- so these cover an outline with
 * nothing in it yet, one filling in, and going back to change a finished part.
 */

const OPTIONS = [
  { key: "folder:chem", label: "Chemistry", folderId: "chem" },
  { key: "folder:bio", label: "Biology", folderId: "bio" },
];

function draft(overrides: Partial<RevisionPlanDraft> = {}): RevisionPlanDraft {
  return normalizeRevisionPlanDraft({
    title: "Summer mocks",
    scopes: [
      { folderId: "chem", weight: 2 },
      { folderId: "bio", weight: 1 },
    ],
    sessions: [
      { id: "a", weekday: 1, minutes: 45, startTime: "16:30", scopeKey: "folder:chem" },
      { id: "b", weekday: 3, minutes: 30 },
    ],
    startDayKey: "2026-09-14",
    endDayKey: "2026-10-12",
    ...overrides,
  }).draft;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(label)
  );
}

describe("the plan taking shape", () => {
  it("shows every section from the start, waiting to be filled", () => {
    render(
      <PlanDraftPreview
        draft={normalizeRevisionPlanDraft(null).draft}
        options={OPTIONS}
        step="goal"
        onEdit={vi.fn()}
      />
    );
    const text = container.textContent ?? "";

    // The outline is the plan's shape before any of it is decided.
    for (const section of ["Working towards", "Subjects", "Your week", "Last check"]) {
      expect(text).toContain(section);
    }
    expect(text).toContain("Jami’s asking");
    expect(text).toContain("Your exams and the date you want to be ready by.");
    // Building it yourself is a first-class way in, not a refusal.
    expect(button("Edit by hand")).toBeTruthy();
    // Nothing starts from here: the last check is where a plan starts.
    expect(button("Start this plan")).toBeUndefined();
  });

  it("fills in what has been answered and marks where Jami is", () => {
    render(<PlanDraftPreview draft={draft()} options={OPTIONS} step="time" onEdit={vi.fn()} />);
    const text = container.textContent ?? "";

    expect(text).toContain("Summer mocks");
    expect(text).toContain("Chemistry");
    expect(text).toContain("Biology");
    expect(text).toContain("16:30–17:15");
    // Rounded to hours past an hour, the same way the saved plan reads it.
    expect(text).toContain("about 1h a week");
    // Goal and subjects are behind; the week is the question on screen.
    const headings = [...container.querySelectorAll("h4")].map((heading) => heading.textContent);
    expect(headings.find((heading) => heading?.startsWith("Your week"))).toContain("Jami’s asking");
  });

  it("counts down to each exam it was given", () => {
    const withExam = normalizeRevisionPlanDraft({
      ...draft(),
      exams: [{ id: "e1", label: "Chemistry Paper 1", dayKey: "2026-11-12", scopeKey: "folder:chem" }],
    }).draft;
    render(<PlanDraftPreview draft={withExam} options={OPTIONS} step="subjects" onEdit={vi.fn()} />);

    expect(container.textContent).toContain("Chemistry Paper 1");
    expect(container.textContent).toContain("Thu 12 Nov");
  });

  it("reopens a finished section's question", () => {
    const onJumpToStep = vi.fn();
    render(
      <PlanDraftPreview
        draft={draft()}
        options={OPTIONS}
        step="extras"
        onEdit={vi.fn()}
        onJumpToStep={onJumpToStep}
      />
    );

    const change = container.querySelector('button[aria-label="Change subjects"]') as HTMLButtonElement;
    act(() => change.click());
    expect(onJumpToStep).toHaveBeenCalledWith("subjects");
  });

  it("names a subject that is no longer on offer rather than showing a bare id", () => {
    render(<PlanDraftPreview draft={draft()} options={[OPTIONS[0]!]} step="review" onEdit={vi.fn()} />);
    expect(container.textContent).toContain("A subject you removed");
  });
});

describe("telling Jami what the plan already says", () => {
  const SUBJECTS = [
    { ref: "S1", label: "Chemistry", folderId: "chem" },
    { ref: "S2", label: "Biology", folderId: "bio" },
  ];

  it("describes the draft in the refs the model was given", () => {
    /*
     * Refs rather than names, so there is nothing in here the model could
     * mistake for a new subject it is allowed to invent.
     */
    const described = describeAssistantPlanDraft(draft(), SUBJECTS);
    expect(described).toContain("S1 weight 2");
    expect(described).toContain("S2 weight 1");
    expect(described).toContain("Mon 16:30 45 min (S1)");
    expect(described).toContain("Wed 30 min");
    expect(described).toContain("2026-09-14 to 2026-10-12");
    expect(described).not.toContain("Chemistry");
  });

  it("says a subject is unknown rather than quietly dropping it", () => {
    const described = describeAssistantPlanDraft(draft(), [SUBJECTS[0]!]);
    expect(described).toContain("unknown");
  });

  it("says nothing at all about an empty draft", () => {
    expect(describeAssistantPlanDraft(normalizeRevisionPlanDraft(null).draft, SUBJECTS)).toBeNull();
  });

  it("describes a draft that so far holds only exams", () => {
    // The first question sets exams before any subject or day, and the next
    // question has to see them.
    const examsOnly = normalizeRevisionPlanDraft({
      title: "Mocks",
      exams: [{ id: "e1", label: "Chemistry Paper 1", dayKey: "2026-11-12" }],
    }).draft;
    expect(describeAssistantPlanDraft(examsOnly, SUBJECTS)).toContain("Chemistry Paper 1");
  });
});
