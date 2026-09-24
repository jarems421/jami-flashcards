// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorSettingsPanel from "@/components/ai/TutorSettingsPanel";
import { DEFAULT_TUTOR_PREFERENCES } from "@/lib/ai/tutor-personalisation";

/**
 * The settings panel's states, which are mostly the ones a student meets when
 * something is wrong: a load that failed, a folder with nothing written for it,
 * an account with no folders at all.
 *
 * Plus the status strip, which is the first thing on the panel and now says all
 * three of those things in three chips rather than three sentences.
 */

const serviceMocks = vi.hoisted(() => ({
  loadTutorPersonalisation: vi.fn(),
  saveTutorPreferences: vi.fn(),
  saveTutorStudyProfile: vi.fn(),
  saveFolderTutorNotes: vi.fn(),
}));

vi.mock("@/services/ai/tutor-personalisation", () => serviceMocks);

let container: HTMLDivElement;
let root: Root;

const FOLDER = {
  id: "folder-1",
  name: "Biology",
  subject: "Biology",
  studyLevel: "post-16-equivalent" as const,
  course: null,
  noteCount: 0,
  instructionsUpdatedAt: 0,
};

function personalisation(overrides: Record<string, unknown> = {}) {
  return {
    preferences: { ...DEFAULT_TUTOR_PREFERENCES },
    accountStudyLevel: "post-16-equivalent",
    accountStudySubjects: ["Biology", "Chemistry"],
    folders: [FOLDER],
    folder: {
      ...FOLDER,
      notes: [],
      instructionsUpdatedAt: 0,
    },
    ...overrides,
  };
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function buttonWithText(text: string) {
  return [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.trim().includes(text)
  );
}

async function openTab(label: string) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (entry) => entry.textContent?.trim() === label
  ) as HTMLButtonElement;
  await act(async () => tab.click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  serviceMocks.loadTutorPersonalisation.mockReset();
  serviceMocks.saveTutorPreferences.mockReset();
  serviceMocks.saveTutorStudyProfile.mockReset();
  serviceMocks.saveFolderTutorNotes.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the Tutor settings panel", () => {
  it("offers a way back only when there is somewhere to go back to", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());

    await render(<TutorSettingsPanel />);
    expect(buttonWithText("Back to chat")).toBeUndefined();

    await render(<TutorSettingsPanel onBack={() => {}} backLabel="Done" />);
    expect(buttonWithText("Done")).toBeDefined();
  });

  it("says the rule when the surface cannot say which folder applies", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());

    await render(<TutorSettingsPanel />);

    // Not "no folder instructions apply", which would be a claim the panel has
    // no basis for.
    expect(container.textContent).toContain("Set per folder");
  });

  it("names the folder when the conversation resolves to exactly one", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(
      personalisation({
        folders: [{ ...FOLDER, noteCount: 2 }],
      })
    );

    await render(<TutorSettingsPanel activeFolderIds={["folder-1"]} />);

    expect(container.textContent).toContain("Biology — 2 notes");
  });

  it("explains the multi-folder case instead of interrupting the chat", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());

    await render(
      <TutorSettingsPanel activeFolderIds={["folder-1", "folder-2"]} />
    );

    expect(container.textContent).toContain("Several folders — off");
  });

  it("reports a failed load and offers a retry rather than an empty form", async () => {
    serviceMocks.loadTutorPersonalisation.mockRejectedValue(
      new Error("Jami could not load your Jami settings.")
    );

    await render(<TutorSettingsPanel />);

    expect(container.textContent).toContain(
      "Jami could not load your Jami settings."
    );
    expect(buttonWithText("Try again")).toBeDefined();
  });

  it("counts nothing as active for an account that has changed nothing", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());

    await render(<TutorSettingsPanel />);

    expect(container.textContent).toContain("Default");
  });

  it("counts the preferences that will actually reach the prompt", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(
      personalisation({
        preferences: {
          ...DEFAULT_TUTOR_PREFERENCES,
          helpApproach: "hints-first",
          feedbackDirectness: "direct",
          notes: ["Name the rule first."],
        },
      })
    );

    await render(<TutorSettingsPanel />);

    expect(container.textContent).toContain("2 changed");
  });

  it("saves a style choice the moment it is picked, with no Save button", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());
    serviceMocks.saveTutorPreferences.mockResolvedValue(DEFAULT_TUTOR_PREFERENCES);

    await render(<TutorSettingsPanel />);
    await openTab("Style");
    expect(buttonWithText("Save changes")).toBeUndefined();

    const option = [...container.querySelectorAll('[role="radio"]')].find(
      (entry) => entry.textContent?.includes("Just explain it")
    ) as HTMLButtonElement;
    await act(async () => option.click());

    expect(serviceMocks.saveTutorPreferences).toHaveBeenCalledWith({
      helpApproach: "explain-directly",
    });
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Saved");
  });

  it("puts a choice back and says so when the save fails", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());
    serviceMocks.saveTutorPreferences.mockRejectedValue(new Error("Offline"));

    await render(<TutorSettingsPanel />);
    await openTab("Style");
    const option = () =>
      [...container.querySelectorAll('[role="radio"]')].find((entry) =>
        entry.textContent?.includes("Just explain it")
      ) as HTMLButtonElement;
    await act(async () => option().click());

    expect(option().getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Offline");
  });

  it("adds a note for every subject from one of the offered ideas", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());
    serviceMocks.saveTutorPreferences.mockResolvedValue(DEFAULT_TUTOR_PREFERENCES);

    await render(<TutorSettingsPanel />);
    await openTab("Notes");
    const idea = buttonWithText("Name the rule or formula before you use it.");
    await act(async () => idea!.click());

    expect(serviceMocks.saveTutorPreferences).toHaveBeenCalledWith({
      notes: ["Name the rule or formula before you use it."],
    });
    expect(
      container.querySelector('[aria-label="Notes for every subject"]')?.textContent
    ).toContain("Name the rule or formula before you use it.");
  });

  it("shows what Jami already knows about a folder before any note is written", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(
      personalisation({
        folder: {
          ...FOLDER,
          course: "AQA · A level Biology",
          notes: [],
          instructionsUpdatedAt: 0,
        },
      })
    );

    await render(<TutorSettingsPanel />);
    await openTab("Notes");

    expect(container.textContent).toContain("Jami already knows");
    expect(container.textContent).toContain("AQA · A level Biology");
    expect(container.textContent).not.toContain("Which course is this for?");
  });

  it("tells a student with no folders what to do first", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(
      personalisation({ folders: [], folder: null })
    );

    await render(<TutorSettingsPanel />);
    await openTab("Notes");

    expect(container.textContent).toContain("No folders yet");
  });

  it("shows the study level Jami will actually use, and where it came from", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(
      personalisation({
        accountStudyLevel: "gcse-equivalent",
        folders: [{ ...FOLDER, studyLevel: "undergraduate" }],
      })
    );

    await render(<TutorSettingsPanel activeFolderIds={["folder-1"]} />);

    expect(container.textContent).toContain("University (folder)");
    expect(container.textContent).toContain("Biology overrides this with");
  });

  it("opens on the course view, because the level is what Jami misses most", async () => {
    serviceMocks.loadTutorPersonalisation.mockResolvedValue(personalisation());

    await render(<TutorSettingsPanel />);

    expect(container.textContent).toContain("Your subjects");
    expect(container.textContent).toContain("Biology");
    expect(container.textContent).toContain("Chemistry");
  });
});
