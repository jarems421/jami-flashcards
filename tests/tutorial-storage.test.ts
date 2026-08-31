// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialTutorialProgress } from "@/lib/onboarding/tutorial";
import {
  mergeTutorialProgress,
  readLocalTutorialProgress,
  saveLocalTutorialProgress,
} from "@/lib/onboarding/tutorial-storage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the walkthrough's local copy", () => {
  it("round-trips progress for one user", () => {
    const progress = {
      ...createInitialTutorialProgress("active"),
      completedMissionIds: ["create-folder" as const],
      currentMissionId: "create-notebook" as const,
    };
    saveLocalTutorialProgress("user-1", progress);

    const read = readLocalTutorialProgress("user-1");
    expect(read?.status).toBe("active");
    expect(read?.completedMissionIds).toEqual(["create-folder"]);
    expect(read?.currentMissionId).toBe("create-notebook");
  });

  it("keeps one student's progress off another's account", () => {
    saveLocalTutorialProgress("user-1", createInitialTutorialProgress("active"));

    expect(readLocalTutorialProgress("user-2")).toBeNull();
  });

  it("normalizes what it reads back, so a tampered copy cannot break the card", () => {
    localStorage.setItem(
      "jami:tutorial:user-1",
      JSON.stringify({ status: "active", currentMissionId: "nonsense" })
    );

    expect(readLocalTutorialProgress("user-1")?.currentMissionId).toBe(
      "create-folder"
    );
  });

  it("treats unreadable storage as having no copy", () => {
    localStorage.setItem("jami:tutorial:user-1", "{not json");
    expect(readLocalTutorialProgress("user-1")).toBeNull();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readLocalTutorialProgress("user-1")).toBeNull();
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(() =>
      saveLocalTutorialProgress("user-1", createInitialTutorialProgress())
    ).not.toThrow();
  });
});

describe("choosing between the local and account copies", () => {
  const local = { ...createInitialTutorialProgress("active"), updatedAt: 200 };
  const remote = { ...createInitialTutorialProgress("paused"), updatedAt: 100 };

  it("takes whichever was written last", () => {
    expect(mergeTutorialProgress(local, remote)).toBe(local);
    expect(mergeTutorialProgress({ ...local, updatedAt: 50 }, remote)).toBe(
      remote
    );
  });

  it("prefers the account on a tie, so a second device does not restart", () => {
    const tie = { ...remote, updatedAt: local.updatedAt };
    expect(mergeTutorialProgress(local, tie)).toBe(tie);
  });

  it("falls back to whichever copy exists", () => {
    expect(mergeTutorialProgress(local, null)).toBe(local);
    expect(mergeTutorialProgress(null, remote)).toBe(remote);
    expect(mergeTutorialProgress(null, null)).toBeNull();
  });
});
