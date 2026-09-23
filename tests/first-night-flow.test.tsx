// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstNightPanel from "@/components/onboarding/FirstNightPanel";
import FirstNightProvider from "@/components/onboarding/FirstNightProvider";
import SecondNightPanel from "@/components/onboarding/SecondNightPanel";
import { createFirstNightState, type FirstNightState } from "@/lib/onboarding/first-night";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";

/**
 * First night as a student moves through it: the tour's last word takes them
 * to their first star, lighting one says what it gave them and offers the
 * next, and the second night picks up once the first is over.
 */

const push = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname.current,
}));
vi.mock("@/services/profile/first-night", () => ({
  loadFirstNight: async () => null,
  saveFirstNight: async () => undefined,
}));
vi.mock("@/services/onboarding/first-night-setup", () => ({
  setUpFirstNightSubjects: async () => ({ created: 0, failed: 0, examReady: true }),
}));
vi.mock("@/services/study/exam-practice", () => ({
  getExamCourseOptions: async () => [],
}));
vi.mock("@/services/constellation/stars", () => ({
  createOnboardingStarIfMissing: async () => ({ status: "pending" }),
}));

let container: HTMLDivElement;
let root: Root;

function seed(patch: Partial<FirstNightState>) {
  localStorage.setItem(
    "jami:first-night:user-1",
    JSON.stringify({ ...createFirstNightState(), ...patch, updatedAt: Date.now() })
  );
}

async function render() {
  await act(async () => {
    root.render(
      <FirstNightProvider userId="user-1">
        <FirstNightPanel />
        <SecondNightPanel />
      </FirstNightProvider>
    );
  });
  await act(async () => {});
}

function button(text: string | RegExp) {
  const match = (value: string) => (typeof text === "string" ? value === text : text.test(value));
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((node) =>
    match(node.textContent?.trim() ?? "")
  );
}

function click(target: HTMLElement | undefined) {
  expect(target).toBeTruthy();
  act(() => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function report(action: Parameters<typeof reportTutorialAction>[0]) {
  await act(async () => {
    reportTutorialAction(action);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  pathname.current = "/dashboard";
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("from the tour into the first star", () => {
  it("goes straight to the first star when the student says let's go", async () => {
    seed({ stage: "tour", tourStep: 1, examReady: true });
    await render();
    click(button("Let's go"));
    expect(push).toHaveBeenCalledWith("/dashboard/practice");
  });

  it("offers the next star on Today with how long it takes, and one press goes there", async () => {
    seed({ stage: "exploring", examReady: true, lit: ["exam"] });
    await render();
    const card = document.querySelector(".fn-next");
    expect(card?.textContent).toContain("Make a flashcard");
    expect(card?.textContent).toContain("about 1 minute");
    click(button(/Take me there/));
    expect(push).toHaveBeenCalledWith("/dashboard/decks");
  });

  it("does not navigate when the student is already where the star is lit", async () => {
    pathname.current = "/dashboard/decks";
    seed({ stage: "exploring", examReady: true, lit: ["exam"] });
    await render();
    click(button(/Take me there/));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("a star lighting", () => {
  it("says what it gave the student and offers the next one", async () => {
    pathname.current = "/dashboard/practice";
    seed({ stage: "exploring", examReady: true });
    await render();
    await report("mark-exam-answer");

    const bloom = document.querySelector(".fn-bloom");
    expect(bloom?.textContent).toContain("Star 1 of 6 lit");
    expect(bloom?.textContent).toContain("first real evidence");
    // The guide waits while the bloom speaks.
    expect(document.querySelector(".fn-guide")).toBeNull();
    click(button("Next: Make a flashcard"));
    expect(push).toHaveBeenCalledWith("/dashboard/decks");
    expect(document.querySelector(".fn-bloom")).toBeNull();
  });

  it("goes away by itself, but not while it is being read", async () => {
    seed({ stage: "exploring", examReady: true });
    await render();
    await report("mark-exam-answer");
    const bloom = document.querySelector<HTMLElement>(".fn-bloom");
    act(() => {
      bloom!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(document.querySelector(".fn-bloom")).not.toBeNull();
    act(() => {
      bloom!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(document.querySelector(".fn-bloom")).toBeNull();
  });

  it("says the constellation is complete on the last star", async () => {
    pathname.current = "/dashboard/goals";
    seed({ stage: "exploring", examReady: true, lit: ["exam", "cards", "learn", "notebook", "tutor"] });
    await render();
    await report("create-goal");
    const bloom = document.querySelector(".fn-bloom");
    expect(bloom?.textContent).toContain("All 6 stars lit");
    click(button("See your constellation"));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });
});

describe("the second night", () => {
  it("is offered once the first night is over, and lights from what the student does", async () => {
    seed({ stage: "finished", rewardState: "awarded" });
    await render();
    expect(document.body.textContent).toContain("Three more stars, if you want them");

    await report("view-progress");
    expect(document.querySelector(".fn-bloom")?.textContent).toContain("Second night · 1 of 3");
    click(button("Next: Give Jami something to read"));
    expect(push).toHaveBeenCalledWith("/dashboard/library");
  });

  it("does not light while the first night is still running", async () => {
    seed({ stage: "exploring", examReady: true });
    await render();
    await report("view-progress");
    expect(document.querySelector(".fn-bloom")).toBeNull();
  });

  it("can be put away in one press", async () => {
    seed({ stage: "finished", rewardState: "awarded" });
    await render();
    click(button("Put away"));
    expect(document.body.textContent).not.toContain("Three more stars");
  });
});
