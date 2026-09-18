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
 * The panel exists so a student can watch the thing take shape and take it over
 * at any point, so these cover the three states that matter: nothing decided
 * yet, something half-decided, and enough to start.
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
  it("shows the subjects, the week and the dates as they stand", () => {
    render(
      <PlanDraftPreview draft={draft()} options={OPTIONS} onEdit={vi.fn()} onStart={vi.fn()} />
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Summer mocks");
    expect(text).toContain("Chemistry");
    expect(text).toContain("Biology");
    expect(text).toContain("16:30–17:15");
    expect(text).toContain("2026-09-14");
    // Rounded to hours past an hour, the same way the saved plan reads it.
    expect(text).toContain("about 1h a week");
  });

  it("offers both ways out at once", () => {
    // The whole point: neither waits for Jami to decide the plan is finished.
    const onEdit = vi.fn();
    const onStart = vi.fn();
    render(<PlanDraftPreview draft={draft()} options={OPTIONS} onEdit={onEdit} onStart={onStart} />);

    act(() => button("Edit details")?.click());
    act(() => button("Start this plan")?.click());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("invites the student in when nothing has been decided", () => {
    render(
      <PlanDraftPreview
        draft={normalizeRevisionPlanDraft(null).draft}
        options={OPTIONS}
        onEdit={vi.fn()}
        onStart={vi.fn()}
      />
    );
    expect(container.textContent).toContain("Nothing here yet");
    // Building it yourself is a first-class way in, not a refusal.
    expect(button("Build it myself")).toBeTruthy();
    expect(button("Start this plan")?.hasAttribute("disabled")).toBe(true);
  });

  it("will not start a plan that is not a plan yet", () => {
    const half = normalizeRevisionPlanDraft({
      title: "Mocks",
      scopes: [{ folderId: "chem", weight: 1 }],
      sessions: [],
    }).draft;
    render(
      <PlanDraftPreview draft={half} options={OPTIONS} onEdit={vi.fn()} onStart={vi.fn()} />
    );
    expect(button("Start this plan")?.hasAttribute("disabled")).toBe(true);
    expect(container.textContent).toContain("Pick at least one day");
  });

  it("names a subject that is no longer on offer rather than showing a bare id", () => {
    render(<PlanDraftPreview draft={draft()} options={[OPTIONS[0]!]} onEdit={vi.fn()} onStart={vi.fn()} />);
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
});
