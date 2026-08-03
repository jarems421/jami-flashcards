import { describe, expect, it } from "vitest";
import {
  getNotebookPageTurnOffset,
  getQueuedNotebookPageTurn,
} from "@/lib/workspace/notebook-navigation-queue";

describe("getQueuedNotebookPageTurn", () => {
  it("queues a flick that resolved to a direction", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: null,
        direction: "next",
        velocityX: -2.4,
      })
    ).toEqual({ direction: "next", velocityX: -2.4 });
  });

  it("keeps only the newest flick", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: { direction: "next", velocityX: -2.4 },
        direction: "previous",
        velocityX: 1.8,
      })
    ).toEqual({ direction: "previous", velocityX: 1.8 });
  });

  it("clears the slot when a release resolves to no direction", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: { direction: "next", velocityX: -2.4 },
        direction: null,
        velocityX: 0.1,
      })
    ).toBeNull();
  });

  it("stores no page index, so the turn applies to whichever page is open", () => {
    const queued = getQueuedNotebookPageTurn({
      current: null,
      direction: "next",
      velocityX: -3,
    });
    expect(queued && Object.keys(queued).sort()).toEqual([
      "direction",
      "velocityX",
    ]);
  });
});

describe("getNotebookPageTurnOffset", () => {
  it("maps a direction onto the offset selectPageByOffset takes", () => {
    expect(getNotebookPageTurnOffset({ direction: "next", velocityX: -2 })).toBe(
      1
    );
    expect(
      getNotebookPageTurnOffset({ direction: "previous", velocityX: 2 })
    ).toBe(-1);
  });
});
