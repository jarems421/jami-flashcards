// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanDraftPreview from "@/components/planning/PlanDraftPreview";
import PlanWithJami from "@/components/planning/PlanWithJami";
import { usePlanInterview } from "@/hooks/usePlanInterview";
import type { PlanInterviewContext } from "@/lib/planning/plan-interview";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import type { RevisionPlanDraft } from "@/lib/planning/types";

/**
 * Making a plan with Jami, the way a student does it: one question at a time,
 * answered by tapping or typing, with the plan beside the conversation filling
 * in as they go, and nothing started until the last check.
 */

const service = vi.hoisted(() => ({
  draftPlanWithJami: vi.fn(),
  PlanDraftError: class PlanDraftError extends Error {},
}));

vi.mock("@/services/planning/plan-draft", () => service);

const OPTIONS = [
  { key: "folder:chem", label: "Chemistry", folderId: "chem" },
  { key: "folder:bio", label: "Biology", folderId: "bio" },
];

const CONTEXT: PlanInterviewContext = {
  notices: [
    { scopeKey: "folder:bio", subject: "Biology", detail: "Enzymes has been slipping", reason: "declining_mastery" },
  ],
  scopeNames: new Map(OPTIONS.map((option) => [option.key, option.label])),
};

function Harness({ onStart }: { onStart: (draft: RevisionPlanDraft) => void }) {
  const interview = usePlanInterview(CONTEXT);
  return (
    <>
      <PlanWithJami
        interview={interview}
        options={OPTIONS}
        notices={CONTEXT.notices}
        saving={false}
        onStart={() => onStart(interview.draft)}
        onEditByHand={vi.fn()}
      />
      <PlanDraftPreview
        draft={interview.draft}
        options={OPTIONS}
        step={interview.step}
        onEdit={vi.fn()}
        onJumpToStep={interview.jumpTo}
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  service.draftPlanWithJami.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found as HTMLButtonElement;
}

function click(element: HTMLElement) {
  act(() => element.click());
}

function priority(subject: string, level: string) {
  const group = container.querySelector(`[aria-label="How much time for ${subject}"]`);
  const option = [...(group?.querySelectorAll('[role="radio"]') ?? [])].find(
    (entry) => entry.textContent === level
  );
  if (!option) throw new Error(`No ${level} for ${subject}`);
  return option as HTMLButtonElement;
}

function outline() {
  return container.querySelector('[aria-label="Your plan so far"]')?.textContent ?? "";
}

function lastJamiQuestion() {
  const turns = [...container.querySelectorAll('[aria-label="Planning with Jami"] li')];
  return turns.at(-1)?.textContent ?? "";
}

describe("making a plan with Jami", () => {
  it("builds the whole plan from taps, filling the outline in as it goes", () => {
    const onStart = vi.fn();
    act(() => root.render(<Harness onStart={onStart} />));

    expect(lastJamiQuestion()).toContain("What are you working towards?");
    // No chips of things Jami noticed above the conversation.
    expect(container.textContent).not.toContain("From what you’ve actually done so far");

    click(button("No exams coming up"));
    expect(outline()).toContain("No exams");
    // What the Learning Engine noticed is said in the question it bears on.
    expect(lastJamiQuestion()).toContain("From your answers in Biology: Enzymes has been slipping.");
    expect(button("These are my subjects").disabled).toBe(true);

    click(priority("Biology", "Most"));
    // The plan fills in on the tap, before the step is answered.
    expect(outline()).toContain("Biology");
    click(priority("Chemistry", "Light"));
    click(button("These are my subjects"));
    expect(lastJamiQuestion()).toContain("When can you study?");

    click(button("Monday"));
    click(button("Thursday"));
    click([...container.querySelectorAll('[role="radio"]')].find((entry) => entry.textContent === "30 min") as HTMLButtonElement);
    expect(outline()).toContain("about 1h a week");
    click(button("That’s my week"));

    expect(lastJamiQuestion()).toContain("Anything else I should fit around?");
    // Still no way to start before the last check.
    expect([...container.querySelectorAll("button")].some((entry) => entry.textContent === "Start this plan")).toBe(false);
    click(button("Nothing else"));

    expect(lastJamiQuestion()).toContain("Any last changes or additions");
    click(button("Start this plan"));

    expect(onStart).toHaveBeenCalledTimes(1);
    const started = onStart.mock.calls[0]?.[0] as RevisionPlanDraft;
    expect(normalizeRevisionPlanDraft(started).valid).toBe(true);
    expect(started.scopes).toEqual([
      { folderId: "bio", weight: 3 },
      { folderId: "chem", weight: 1 },
    ]);
    expect(started.sessions.map((session) => [session.weekday, session.minutes])).toEqual([
      [1, 30],
      [4, 30],
    ]);
    expect(service.draftPlanWithJami).not.toHaveBeenCalled();
  });

  it("reads a typed answer against the step it answers", async () => {
    service.draftPlanWithJami.mockResolvedValue({
      reply: "Chemistry paper 1 on the 12th of November, noted.",
      plan: normalizeRevisionPlanDraft({
        title: "Chemistry mocks",
        exams: [{ id: "e1", label: "Chemistry Paper 1", dayKey: "2026-11-12", scopeKey: "folder:chem" }],
        scopes: [{ folderId: "chem", weight: 2 }],
      }).draft,
      notices: [],
    });
    act(() => root.render(<Harness onStart={vi.fn()} />));

    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(box, "Chemistry paper 1 on 12 November");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Send to Jami").click();
    });

    expect(service.draftPlanWithJami).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Chemistry paper 1 on 12 November", step: "goal" })
    );
    expect(container.textContent).toContain("Chemistry paper 1 on the 12th of November, noted.");
    expect(outline()).toContain("Chemistry Paper 1");
    expect(lastJamiQuestion()).toContain("I've put Chemistry in because of your exams.");
  });

  it("keeps the tapped answers when Jami cannot answer", async () => {
    service.draftPlanWithJami.mockRejectedValue(new Error("offline"));
    act(() => root.render(<Harness onStart={vi.fn()} />));

    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(box, "mocks soon");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Send to Jami").click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("answer with the options below");
    expect(button("No exams coming up")).toBeTruthy();
  });

  it("goes back to a finished question from the plan", () => {
    act(() => root.render(<Harness onStart={vi.fn()} />));
    click(button("No exams coming up"));
    click(priority("Chemistry", "Normal"));
    click(button("These are my subjects"));

    click(button("Change subjects"));
    expect(lastJamiQuestion()).toContain("Which subjects should this cover?");
    // Reopened with the answer it had, ready to change.
    expect(priority("Chemistry", "Normal").getAttribute("aria-checked")).toBe("true");
  });
});
