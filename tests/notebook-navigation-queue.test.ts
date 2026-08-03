import { describe, expect, it } from "vitest";
import {
  getNotebookPageTurnOffset,
  getQueuedNotebookPageTurn,
  resolveQueuedNotebookPageTurn,
  type NotebookQueuedPageTurn,
} from "@/lib/workspace/notebook-navigation-queue";

const turn = (
  direction: "next" | "previous",
  createsPage = false
): NotebookQueuedPageTurn => ({
  direction,
  velocityX: direction === "next" ? -2.4 : 2.4,
  createsPage,
});

describe("getQueuedNotebookPageTurn", () => {
  it("queues a flick that resolved to a direction", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: null,
        direction: "next",
        velocityX: -2.4,
      })
    ).toEqual({ direction: "next", velocityX: -2.4, createsPage: false });
  });

  it("keeps only the newest flick", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: turn("next"),
        direction: "previous",
        velocityX: 1.8,
      })
    ).toEqual({
      direction: "previous",
      velocityX: 1.8,
      createsPage: false,
    });
  });

  it("clears the slot when a release resolves to no direction", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: turn("next"),
        direction: null,
        velocityX: 0.1,
      })
    ).toBeNull();
  });

  it("remembers a hard forward pull, which may yet make a page", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: null,
        createsPage: true,
        direction: "next",
        velocityX: -3,
      })?.createsPage
    ).toBe(true);
  });

  it("never treats a backward flick as page creation", () => {
    expect(
      getQueuedNotebookPageTurn({
        current: null,
        createsPage: true,
        direction: "previous",
        velocityX: 3,
      })?.createsPage
    ).toBe(false);
  });

  it("stores no page index, so the turn applies to whichever page is open", () => {
    const queued = getQueuedNotebookPageTurn({
      current: null,
      direction: "next",
      velocityX: -3,
    });
    expect(queued && Object.keys(queued).sort()).toEqual([
      "createsPage",
      "direction",
      "velocityX",
    ]);
  });
});

describe("getNotebookPageTurnOffset", () => {
  it("maps a direction onto the offset selectPageByOffset takes", () => {
    expect(getNotebookPageTurnOffset(turn("next"))).toBe(1);
    expect(getNotebookPageTurnOffset(turn("previous"))).toBe(-1);
  });
});

describe("resolveQueuedNotebookPageTurn", () => {
  const resolve = (
    queued: NotebookQueuedPageTurn,
    selectedPageIndex: number,
    canCreatePage = true
  ) =>
    resolveQueuedNotebookPageTurn({
      canCreatePage,
      pageCount: 3,
      selectedPageIndex,
      turn: queued,
    });

  it("turns the page in the middle of a notebook", () => {
    expect(resolve(turn("next"), 0)).toBe("turn");
    expect(resolve(turn("previous"), 2)).toBe("turn");
  });

  it("makes a page when a hard forward pull lands on the last one", () => {
    expect(resolve(turn("next", true), 2)).toBe("create");
  });

  it("does nothing past the last page when the pull was only a flick", () => {
    expect(resolve(turn("next"), 2)).toBe("none");
  });

  it("does not make a page while editing is unavailable", () => {
    expect(resolve(turn("next", true), 2, false)).toBe("none");
  });

  it("does nothing before the first page", () => {
    expect(resolve(turn("previous"), 0)).toBe("none");
  });
});
