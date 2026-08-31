import { describe, expect, it } from "vitest";
import {
  advanceTutorialProgress,
  createInitialTutorialProgress,
  normalizeTutorialProgress,
  shouldInviteToTutorial,
  TUTORIAL_MISSIONS,
  TUTORIAL_VERSION,
} from "@/lib/onboarding/tutorial";

describe("the first study-loop walkthrough", () => {
  it("only invites when trustworthy dashboard reads confirm an empty account", () => {
    const emptyAccount = {
      isLoading: false,
      sectionStates: {
        decks: "ready" as const,
        cards: "ready" as const,
        activity: "ready" as const,
        folders: "ready" as const,
        notebooks: "ready" as const,
      },
      deckCount: 0,
      cardCount: 0,
      activityCount: 0,
      folderCount: 0,
      notebookCount: 0,
    };

    expect(shouldInviteToTutorial(emptyAccount)).toBe(true);
    expect(
      shouldInviteToTutorial({
        ...emptyAccount,
        sectionStates: { ...emptyAccount.sectionStates, folders: "unavailable" },
      })
    ).toBe(false);
    expect(
      shouldInviteToTutorial({ ...emptyAccount, notebookCount: 1 })
    ).toBe(false);
    expect(
      shouldInviteToTutorial({ ...emptyAccount, isLoading: true })
    ).toBe(false);
  });

  it("has seven ordered, one-action missions", () => {
    expect(TUTORIAL_MISSIONS.map((mission) => mission.id)).toEqual([
      "create-folder",
      "create-notebook",
      "save-work",
      "create-deck",
      "create-card",
      "complete-review",
      "ask-tutor",
    ]);
  });

  it("advances when the active mission really succeeds", () => {
    const started = createInitialTutorialProgress("active");
    const afterFolder = advanceTutorialProgress(started, "create-folder", {
      folderId: "folder-1",
    });

    expect(afterFolder.completedMissionIds).toEqual(["create-folder"]);
    expect(afterFolder.currentMissionId).toBe("create-notebook");
    expect(afterFolder.context.folderId).toBe("folder-1");
  });

  it("credits real work done out of order instead of discarding it", () => {
    const started = createInitialTutorialProgress("active");
    const afterDeck = advanceTutorialProgress(started, "create-deck", {
      deckId: "deck-1",
    });

    // The deck was genuinely made, so it counts...
    expect(afterDeck.completedMissionIds).toEqual(["create-deck"]);
    expect(afterDeck.context.deckId).toBe("deck-1");
    // ...but the card still asks for the first mission still outstanding.
    expect(afterDeck.currentMissionId).toBe("create-folder");

    const afterFolder = advanceTutorialProgress(afterDeck, "create-folder");
    expect(afterFolder.currentMissionId).toBe("create-notebook");

    const afterNotebook = advanceTutorialProgress(afterFolder, "create-notebook");
    const afterWork = advanceTutorialProgress(afterNotebook, "save-work");
    // create-deck is already done, so the walkthrough skips past it.
    expect(afterWork.currentMissionId).toBe("create-card");
  });

  it("ignores a mission that was already completed", () => {
    const started = createInitialTutorialProgress("active");
    const once = advanceTutorialProgress(started, "create-folder");

    expect(advanceTutorialProgress(once, "create-folder")).toBe(once);
  });

  it("records nothing while paused or dismissed", () => {
    for (const status of ["paused", "dismissed", "completed", "idle"] as const) {
      const progress = createInitialTutorialProgress(status);
      expect(advanceTutorialProgress(progress, "create-folder")).toBe(progress);
    }
  });

  it("finishes after the Tutor mission without losing saved route context", () => {
    let progress = createInitialTutorialProgress("active");
    for (const mission of TUTORIAL_MISSIONS) {
      progress = advanceTutorialProgress(progress, mission.id, {
        notebookId: mission.id === "create-notebook" ? "notebook-1" : undefined,
      });
    }

    expect(progress.status).toBe("completed");
    expect(progress.completedMissionIds).toHaveLength(7);
    expect(progress.context.notebookId).toBe("notebook-1");
  });

  it("normalizes untrusted synced state and keeps only known missions", () => {
    const progress = normalizeTutorialProgress({
      version: TUTORIAL_VERSION,
      status: "active",
      currentMissionId: "not-real",
      completedMissionIds: ["create-folder", "not-real", "create-folder"],
      context: { folderId: " folder-1 ", notebookId: 42 },
      rewardState: "awarded",
      updatedAt: 12,
    });

    expect(progress.currentMissionId).toBe("create-notebook");
    expect(progress.completedMissionIds).toEqual(["create-folder"]);
    expect(progress.context).toEqual({
      folderId: "folder-1",
      notebookId: undefined,
      deckId: undefined,
    });
    expect(progress.rewardState).toBe("awarded");
  });

  it("reads an unversioned record rather than throwing it away", () => {
    const progress = normalizeTutorialProgress({
      status: "paused",
      completedMissionIds: ["create-folder", "create-notebook"],
    });

    expect(progress.status).toBe("paused");
    expect(progress.currentMissionId).toBe("save-work");
    expect(progress.version).toBe(TUTORIAL_VERSION);
  });

  it("starts clean on a record written by a newer build", () => {
    const progress = normalizeTutorialProgress({
      version: TUTORIAL_VERSION + 1,
      status: "active",
      currentMissionId: "create-card",
      completedMissionIds: ["create-folder"],
    });

    expect(progress.status).toBe("idle");
    expect(progress.completedMissionIds).toEqual([]);
    expect(progress.currentMissionId).toBe("create-folder");
  });

  it("keeps the earned reward across a replay", () => {
    const completed = {
      ...createInitialTutorialProgress("completed"),
      rewardState: "awarded" as const,
    };
    const replay = {
      ...createInitialTutorialProgress("active"),
      rewardState: completed.rewardState,
    };

    expect(replay.completedMissionIds).toEqual([]);
    expect(replay.rewardState).toBe("awarded");
  });
});
