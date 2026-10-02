// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStudyDayKey } from "@/lib/study/day";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const signedIn = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; getIdToken: () => Promise<string> },
}));

vi.mock("@/services/firebase/client", () => ({ auth: signedIn }));

const {
  clearStoredStudyActions,
  loadStudyActionsForToday,
  readStoredStudyActions,
} = await import("@/services/learning/study-actions");
const { useStudyActions } = await import("@/hooks/useStudyActions");

const ACTIONS = {
  actions: [{ id: "action-1", reason: "low_mastery" }],
  folders: [{ id: "folder-1", name: "Biology" }],
  generatedAt: Date.now(),
};

function answerWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  signedIn.currentUser = null;
});

describe("the suggestions kept for the next launch", () => {
  it("keeps the last answer for the study day it was given on", async () => {
    signedIn.currentUser = { uid: "keeper", getIdToken: async () => "token" };
    answerWith(ACTIONS);
    await loadStudyActionsForToday({ force: true });

    const today = getStudyDayKey(ACTIONS.generatedAt);
    expect(readStoredStudyActions("keeper", today)?.actions).toEqual(ACTIONS.actions);
    expect(readStoredStudyActions("keeper", today)?.folders).toEqual(ACTIONS.folders);
    // Yesterday's advice is not today's.
    expect(readStoredStudyActions("keeper", "1999-01-01")).toBeNull();
    // Nor is anyone else's.
    expect(readStoredStudyActions("someone-else", today)).toBeNull();
  });

  it("is not shown by a build that did not keep it, and goes at sign-out", async () => {
    signedIn.currentUser = { uid: "builder", getIdToken: async () => "token" };
    answerWith(ACTIONS);
    await loadStudyActionsForToday({ force: true });
    const key = "jami:today-actions:builder";
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    const today = getStudyDayKey(ACTIONS.generatedAt);

    window.localStorage.setItem(key, JSON.stringify({ ...stored, build: "some-other-build" }));
    expect(readStoredStudyActions("builder", today)).toBeNull();

    window.localStorage.setItem(key, JSON.stringify(stored));
    expect(readStoredStudyActions("builder", today)).not.toBeNull();
    clearStoredStudyActions();
    expect(readStoredStudyActions("builder", today)).toBeNull();
  });

  it("puts the kept suggestions on Today at once, and the new ones when they come", async () => {
    signedIn.currentUser = { uid: "returning", getIdToken: async () => "token" };
    answerWith(ACTIONS);
    await loadStudyActionsForToday({ force: true });
    // A new launch: nothing in memory, only what the device kept.
    vi.resetModules();
    vi.doMock("@/services/firebase/client", () => ({ auth: signedIn }));
    const { useStudyActions: freshHook } = await import("@/hooks/useStudyActions");

    let answer: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
    );
    const seen: { status: string; ids: string[] }[] = [];
    function Probe() {
      const state = freshHook("returning", true);
      seen.push({ status: state.status, ids: state.actions.map((action) => action.id) });
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    // The very first render already has the kept suggestion.
    expect(seen[0]).toEqual({ status: "ready", ids: ["action-1"] });

    await act(async () => {
      answer(
        new Response(
          JSON.stringify({ ...ACTIONS, actions: [{ id: "action-2", reason: "due_review" }] }),
          { status: 200 }
        )
      );
    });
    expect(seen.at(-1)).toEqual({ status: "ready", ids: ["action-2"] });
    act(() => root.unmount());
  });

  it("starts from nothing when there is nothing kept", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    signedIn.currentUser = { uid: "first-launch", getIdToken: async () => "token" };
    const seen: string[] = [];
    function Probe() {
      seen.push(useStudyActions("first-launch", true).status);
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(seen[0]).toBe("loading");
    act(() => root.unmount());
  });
});
