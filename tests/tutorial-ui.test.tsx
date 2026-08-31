// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorialProvider, {
  TutorialAccountCard,
  TutorialResumeCard,
  useTutorial,
} from "@/components/onboarding/TutorialProvider";
import {
  createInitialTutorialProgress,
  reportTutorialAction,
  TUTORIAL_MISSIONS,
  type TutorialProgress,
} from "@/lib/onboarding/tutorial";

const push = vi.hoisted(() => vi.fn());
const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const loadTutorialProgress = vi.hoisted(() => vi.fn());
const saveTutorialProgress = vi.hoisted(() => vi.fn());
vi.mock("@/services/profile/tutorial", () => ({
  loadTutorialProgress: (...args: unknown[]) => loadTutorialProgress(...args),
  saveTutorialProgress: (...args: unknown[]) => saveTutorialProgress(...args),
}));

const createOnboardingStarIfMissing = vi.hoisted(() => vi.fn());
vi.mock("@/services/constellation/stars", () => ({
  createOnboardingStarIfMissing: (...args: unknown[]) =>
    createOnboardingStarIfMissing(...args),
}));

const HOLD_MS = 3_200;
const FADE_MS = 300;
const SPOTLIGHT_HOLD_MS = 2_400;

let container: HTMLDivElement;
let root: Root;

function Harness({ cards = false }: { cards?: boolean }) {
  const tutorial = useTutorial();
  return (
    <div>
      <span data-testid="status">{tutorial.progress.status}</span>
      <button type="button" data-testid="invite" onClick={tutorial.invite}>
        invite
      </button>
      <button type="button" data-tutorial-target="create-folder">
        Create folder
      </button>
      {cards ? (
        <>
          <TutorialResumeCard />
          <TutorialAccountCard />
        </>
      ) : null}
    </div>
  );
}

async function render(cards = false) {
  await act(async () => {
    root.render(
      <TutorialProvider userId="user-1">
        <Harness cards={cards} />
      </TutorialProvider>
    );
  });
  // Let the account read settle before anything is asserted.
  await act(async () => {});
}

const testId = (id: string) => document.querySelector<HTMLElement>(`[data-testid='${id}']`);
const status = () => testId("status")?.textContent;

function byText(text: string, selector = "button") {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (node) => node.textContent?.trim() === text
  );
}

function click(target: EventTarget | null | undefined) {
  expect(target).toBeTruthy();
  act(() => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function escape() {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The last progress the provider tried to sync, whatever else it also wrote. */
function lastSaved(): TutorialProgress {
  const calls = saveTutorialProgress.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)![1] as TutorialProgress;
}

beforeEach(() => {
  // React needs to know these renders are wrapped, or effects scheduled from a
  // requestAnimationFrame callback warn on every tick the timers advance.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  pathname.current = "/dashboard";
  loadTutorialProgress.mockResolvedValue(null);
  saveTutorialProgress.mockResolvedValue(undefined);
  createOnboardingStarIfMissing.mockResolvedValue({ status: "pending" });
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("the walkthrough invitation", () => {
  it("is not shown until an empty account asks for it", async () => {
    await render();
    expect(testId("tutorial-welcome")).toBeNull();

    click(testId("invite"));
    expect(testId("tutorial-welcome")).not.toBeNull();
    expect(byText("Start walkthrough")).toBeDefined();
    expect(byText("Explore on my own")).toBeDefined();
  });

  it("starts the walkthrough at the first mission", async () => {
    await render();
    click(testId("invite"));
    click(byText("Start walkthrough"));

    expect(status()).toBe("active");
    expect(push).toHaveBeenCalledWith("/dashboard/practice");
    expect(testId("tutorial-quest")?.textContent).toContain("Mission 1 of 7");
    expect(testId("tutorial-quest")?.textContent).toContain(
      TUTORIAL_MISSIONS[0].title
    );
  });

  it("retires the walkthrough only when Explore on my own is chosen", async () => {
    await render();
    click(testId("invite"));
    click(byText("Explore on my own"));

    expect(status()).toBe("dismissed");
    expect(lastSaved().status).toBe("dismissed");
    expect(testId("tutorial-welcome")).toBeNull();
  });

  it("treats Escape as 'not now', leaving the walkthrough on offer", async () => {
    await render();
    click(testId("invite"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    escape();

    expect(testId("tutorial-welcome")).toBeNull();
    expect(status()).toBe("idle");
    expect(saveTutorialProgress).not.toHaveBeenCalled();
  });

  it("is offered once a session, so closing it does not reopen it", async () => {
    await render();
    click(testId("invite"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    escape();

    click(testId("invite"));
    expect(testId("tutorial-welcome")).toBeNull();
  });
});

describe("the quest card", () => {
  beforeEach(() => {
    loadTutorialProgress.mockResolvedValue(
      createInitialTutorialProgress("active")
    );
  });

  it("asks for one mission at a time and can be collapsed", async () => {
    await render();

    expect(testId("tutorial-quest")?.textContent).toContain(
      TUTORIAL_MISSIONS[0].detail
    );

    click(
      document.querySelector<HTMLElement>(
        "[aria-label='Collapse walkthrough mission']"
      )
    );
    expect(testId("tutorial-quest")).toBeNull();
    expect(testId("tutorial-quest-collapsed")).not.toBeNull();
  });

  it("warns before pausing, and keeps going if that is the answer", async () => {
    await render();
    click(byText("Pause"));

    const dialog = testId("tutorial-pause");
    expect(dialog?.textContent).toContain("Pause walkthrough?");
    expect(dialog?.textContent).toContain(
      "Your progress is saved. Resume from Today or Account whenever you want."
    );

    click(byText("Keep going"));
    expect(testId("tutorial-pause")).toBeNull();
    expect(status()).toBe("active");
  });

  it("pauses when that is the answer", async () => {
    await render();
    click(byText("Pause"));
    click(byText("Pause walkthrough"));

    expect(status()).toBe("paused");
    expect(lastSaved().status).toBe("paused");
    expect(testId("tutorial-quest")).toBeNull();
  });
});

describe("the mission spotlight", () => {
  beforeEach(() => {
    loadTutorialProgress.mockResolvedValue(
      createInitialTutorialProgress("active")
    );
    // jsdom lays nothing out, so every element measures zero and the spotlight
    // would correctly decide it has nothing to ring. Give the target a size.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 40,
      left: 24,
      width: 160,
      height: 44,
      right: 184,
      bottom: 84,
      x: 24,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect);
  });

  it("rings the mission's control, then clears itself and stays gone", async () => {
    await render();
    await advance(32);

    expect(testId("tutorial-spotlight")).not.toBeNull();

    await advance(SPOTLIGHT_HOLD_MS + 400);
    expect(testId("tutorial-spotlight")).toBeNull();

    // The old spotlight watched the document and came back on any change.
    document.body.appendChild(document.createElement("span"));
    await advance(400);
    expect(testId("tutorial-spotlight")).toBeNull();
  });
});

describe("finishing the walkthrough", () => {
  beforeEach(() => {
    loadTutorialProgress.mockResolvedValue({
      ...createInitialTutorialProgress("active"),
      completedMissionIds: TUTORIAL_MISSIONS.slice(0, 6).map(
        (mission) => mission.id
      ),
      currentMissionId: "ask-tutor" as const,
    });
  });

  it("awards the star, shows the reward, then the completion screen", async () => {
    createOnboardingStarIfMissing.mockResolvedValue({
      status: "awarded",
      star: {
        id: "onboarding-first-loop",
        goalId: "",
        constellationId: "constellation-1",
        size: 22,
        glow: 0.85,
        color: "white",
        position: { x: 50, y: 50 },
        createdAt: 1,
        presetId: "classic",
      },
    });

    await render();
    await act(async () => {
      reportTutorialAction("ask-tutor");
    });

    expect(status()).toBe("completed");
    expect(createOnboardingStarIfMissing).toHaveBeenCalledWith("user-1");
    expect(document.querySelector(".star-reward-overlay")?.textContent).toContain(
      "First study loop"
    );

    await advance(HOLD_MS + FADE_MS);
    expect(document.querySelector(".star-reward-overlay")).toBeNull();
    expect(testId("tutorial-completion")?.textContent).toContain(
      "Your first loop is complete."
    );
    expect(testId("tutorial-completion")?.textContent).toContain("See Progress");
  });

  it("says the star is waiting when the constellation is full", async () => {
    createOnboardingStarIfMissing.mockResolvedValue({ status: "pending" });

    await render();
    await act(async () => {
      reportTutorialAction("ask-tutor");
    });

    expect(document.querySelector(".star-reward-overlay")).toBeNull();
    expect(testId("tutorial-completion")?.textContent).toContain(
      "saved for the next open place"
    );
    expect(lastSaved().rewardState).toBe("pending");
  });

  it("never mints a second star when the walkthrough is replayed", async () => {
    createOnboardingStarIfMissing.mockResolvedValue({
      status: "exists",
      star: {
        id: "onboarding-first-loop",
        goalId: "",
        constellationId: "constellation-1",
        size: 22,
        glow: 0.85,
        color: "white",
        position: { x: 50, y: 50 },
        createdAt: 1,
        presetId: "classic",
      },
    });

    await render();
    await act(async () => {
      reportTutorialAction("ask-tutor");
    });

    expect(document.querySelector(".star-reward-overlay")).toBeNull();
    expect(lastSaved().rewardState).toBe("awarded");
  });
});

describe("resuming and replaying", () => {
  it("offers a quiet Resume on Today while paused", async () => {
    loadTutorialProgress.mockResolvedValue({
      ...createInitialTutorialProgress("paused"),
      completedMissionIds: ["create-folder" as const],
      currentMissionId: "create-notebook" as const,
    });

    await render(true);

    expect(document.body.textContent).toContain("Walkthrough paused");
    click(byText("Resume"));
    expect(status()).toBe("active");
    expect(push).toHaveBeenCalled();
  });

  it("offers a replay from Account once the loop is finished", async () => {
    loadTutorialProgress.mockResolvedValue({
      ...createInitialTutorialProgress("completed"),
      completedMissionIds: TUTORIAL_MISSIONS.map((mission) => mission.id),
      rewardState: "awarded" as const,
    });

    await render(true);

    expect(document.body.textContent).toContain("First loop complete");
    click(byText("Replay walkthrough"));
    expect(status()).toBe("active");
    expect(lastSaved().rewardState).toBe("awarded");
    expect(lastSaved().completedMissionIds).toEqual([]);
  });

  it("keeps retrying a pending star while a replay is active", async () => {
    loadTutorialProgress.mockResolvedValue({
      ...createInitialTutorialProgress("active"),
      rewardState: "pending" as const,
    });
    createOnboardingStarIfMissing.mockResolvedValue({
      status: "awarded",
      star: {
        id: "onboarding-first-loop",
        goalId: "",
        constellationId: "constellation-1",
        size: 22,
        glow: 0.85,
        color: "white",
        position: { x: 50, y: 50 },
        createdAt: 1,
        presetId: "classic",
      },
    });

    await render();

    expect(createOnboardingStarIfMissing).toHaveBeenCalledWith("user-1");
    expect(lastSaved().status).toBe("active");
    expect(lastSaved().rewardState).toBe("awarded");
  });
});

describe("when the account copy cannot be read", () => {
  it("carries on from the local copy instead of restarting", async () => {
    localStorage.setItem(
      "jami:tutorial:user-1",
      JSON.stringify({
        ...createInitialTutorialProgress("active"),
        completedMissionIds: ["create-folder", "create-notebook"],
        currentMissionId: "save-work",
      })
    );
    loadTutorialProgress.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await render();

    expect(status()).toBe("active");
    expect(testId("tutorial-quest")?.textContent).toContain("Mission 3 of 7");
    warn.mockRestore();
  });

  it("mirrors progress locally as it goes, so a reload does not lose it", async () => {
    loadTutorialProgress.mockResolvedValue(
      createInitialTutorialProgress("active")
    );
    await render();

    click(byText("Pause"));
    click(byText("Pause walkthrough"));

    const stored = JSON.parse(
      localStorage.getItem("jami:tutorial:user-1") ?? "null"
    );
    expect(stored.status).toBe("paused");
  });
});
