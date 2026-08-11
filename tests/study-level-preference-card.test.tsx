// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyLevelPreferenceCard from "@/components/profile/StudyLevelPreferenceCard";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/services/profile", () => ({
  loadDefaultStudyLevel: mocks.load,
  saveDefaultStudyLevel: mocks.save,
}));

let container: HTMLDivElement;
let root: Root;

function studyLevelSelect() {
  return document.querySelector<HTMLSelectElement>("select");
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue("gcse-equivalent");
  mocks.save.mockReset().mockResolvedValue("post-16-equivalent");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StudyLevelPreferenceCard", () => {
  it("loads and saves a changeable account default", async () => {
    await act(async () => {
      root.render(<StudyLevelPreferenceCard userId="user-1" />);
    });

    expect(mocks.load).toHaveBeenCalledWith("user-1");
    expect(studyLevelSelect()?.value).toBe("gcse-equivalent");
    expect(button("Save study level")?.disabled).toBe(true);

    await act(async () => {
      const select = studyLevelSelect()!;
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set?.call(select, "post-16-equivalent");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button("Save study level")?.disabled).toBe(false);

    await act(async () => {
      button("Save study level")?.click();
    });

    expect(mocks.save).toHaveBeenCalledWith(
      "user-1",
      "post-16-equivalent"
    );
    expect(container.textContent).toContain("Default study level saved.");
  });
});
