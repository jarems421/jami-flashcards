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
  /*
   * Choosing a level is what saves it.
   *
   * This used to need a second click on a "Save study level" button, while the
   * theme picker beside it on the same page saved on choosing -- so picking a
   * level and walking away looked identical to setting one and stored nothing.
   * The account it was found on had no stored level at all, and the tutor had
   * been pitching every answer with nothing to go on.
   */
  it("saves the moment a level is chosen, with no second click", async () => {
    await act(async () => {
      root.render(<StudyLevelPreferenceCard userId="user-1" />);
    });

    expect(mocks.load).toHaveBeenCalledWith("user-1");
    expect(studyLevelSelect()?.value).toBe("gcse-equivalent");
    expect(mocks.save).not.toHaveBeenCalled();

    await act(async () => {
      const select = studyLevelSelect()!;
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value"
      )?.set?.call(select, "post-16-equivalent");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.save).toHaveBeenCalledWith("user-1", "post-16-equivalent");
    expect(container.textContent).toContain("Default study level saved.");
  });

  it("lets the last choice win when an earlier save is still in flight", async () => {
    // Two quick changes: the slow first write must not overwrite the second.
    let releaseFirst: (value: string) => void = () => {};
    mocks.save
      .mockReset()
      .mockImplementationOnce(
        () => new Promise<string>((resolve) => { releaseFirst = resolve; })
      )
      .mockResolvedValueOnce("undergraduate");

    await act(async () => {
      root.render(<StudyLevelPreferenceCard userId="user-1" />);
    });

    const choose = async (value: string) => {
      await act(async () => {
        const select = studyLevelSelect()!;
        Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          "value"
        )?.set?.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    await choose("post-16-equivalent");
    await choose("undergraduate");
    await act(async () => { releaseFirst("post-16-equivalent"); });

    expect(studyLevelSelect()?.value).toBe("undergraduate");
  });
});
