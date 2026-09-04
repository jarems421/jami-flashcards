// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorReasoningMenu from "@/components/ai/TutorReasoningMenu";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/services/profile", () => ({
  loadReasoningEffort: mocks.load,
  saveReasoningEffort: mocks.save,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue("medium");
  mocks.save.mockReset().mockImplementation(async (_userId, effort) => effort);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderMenu() {
  await act(async () => {
    root.render(
      <TutorReasoningMenu
        userId="user-1"
        onSaveStarted={() => undefined}
        onError={vi.fn()}
      />
    );
  });
}

describe("TutorReasoningMenu", () => {
  it("shows the saved level and explains every choice in a compact menu", async () => {
    await renderMenu();

    expect(
      container.querySelector("summary")?.getAttribute("aria-label")
    ).toBe("Reasoning: Medium");
    expect(container.textContent).toContain("Fastest for straightforward questions");
    expect(container.textContent).toContain("More thought when useful");
    expect(container.textContent).toContain("Deepest reasoning for difficult work");
  });

  it("saves a choice immediately and updates the composer pill", async () => {
    await renderMenu();
    const high = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("High")
    );

    await act(async () => {
      high?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.save).toHaveBeenCalledWith("user-1", "high");
    expect(
      container.querySelector("summary")?.getAttribute("aria-label")
    ).toBe("Reasoning: High");
  });
});
