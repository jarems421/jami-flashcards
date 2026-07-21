import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampNotebookToolbarDragOffset,
  getNotebookToolbarDragThreshold,
  getNotebookToolbarDragVelocity,
  getNotebookToolbarSettleDuration,
  getNearestNotebookToolbarDock,
  hasNotebookToolbarDragStarted,
  isNotebookToolbarDock,
  isNotebookToolbarSideDock,
  NOTEBOOK_TOOLBAR_DOCK_STORAGE_KEY,
  readNotebookToolbarDockPreference,
  saveNotebookToolbarDockPreference,
} from "@/lib/workspace/notebook-toolbar";

describe("notebook toolbar docking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts only the four supported fixed docks", () => {
    expect(isNotebookToolbarDock("top")).toBe(true);
    expect(isNotebookToolbarDock("right")).toBe(true);
    expect(isNotebookToolbarDock("bottom")).toBe(true);
    expect(isNotebookToolbarDock("left")).toBe(true);
    expect(isNotebookToolbarDock("center")).toBe(false);
    expect(isNotebookToolbarDock(null)).toBe(false);
  });

  it("uses a movement threshold so taps do not become drags", () => {
    expect(hasNotebookToolbarDragStarted({ deltaX: 2, deltaY: 3 })).toBe(false);
    expect(hasNotebookToolbarDragStarted({ deltaX: 4, deltaY: 0 })).toBe(true);
  });

  it("gives Pencil action taps more movement tolerance before dragging", () => {
    expect(
      getNotebookToolbarDragThreshold({
        pointerType: "pen",
        startedOnAction: true,
      })
    ).toBe(8);
    expect(
      getNotebookToolbarDragThreshold({
        pointerType: "touch",
        startedOnAction: true,
      })
    ).toBe(8);
    expect(
      getNotebookToolbarDragThreshold({
        pointerType: "mouse",
        startedOnAction: true,
      })
    ).toBe(4);
    expect(
      getNotebookToolbarDragThreshold({
        pointerType: "pen",
        startedOnAction: false,
      })
    ).toBe(4);
    expect(
      hasNotebookToolbarDragStarted({
        deltaX: 6,
        deltaY: 0,
        threshold: 8,
      })
    ).toBe(false);
    expect(
      hasNotebookToolbarDragStarted({
        deltaX: 8,
        deltaY: 0,
        threshold: 8,
      })
    ).toBe(true);
  });

  it("measures release velocity from only the latest 100ms of movement", () => {
    expect(
      getNotebookToolbarDragVelocity([
        { x: 0, y: 0, timeStamp: 0 },
        { x: 100, y: 0, timeStamp: 100 },
        { x: 100, y: 0, timeStamp: 150 },
        { x: 150, y: 0, timeStamp: 200 },
      ])
    ).toBe(0.5);
  });

  it("settles nearby or fast releases more quickly within safe bounds", () => {
    expect(
      getNotebookToolbarSettleDuration({ distance: 20, velocity: 0 })
    ).toBe(120);
    expect(
      getNotebookToolbarSettleDuration({ distance: 600, velocity: 0 })
    ).toBe(218);
    expect(
      getNotebookToolbarSettleDuration({ distance: 600, velocity: 4 })
    ).toBe(148);
    expect(
      getNotebookToolbarSettleDuration({ distance: 4000, velocity: 0 })
    ).toBe(240);
  });

  it("clamps the toolbar inside the notebook workspace while dragging", () => {
    expect(
      clampNotebookToolbarDragOffset({
        deltaX: -200,
        deltaY: 500,
        originLeft: 100,
        originTop: 60,
        toolbarWidth: 300,
        toolbarHeight: 56,
        frameWidth: 800,
        frameHeight: 600,
      })
    ).toEqual({ x: -92, y: 476 });
  });

  it.each([
    [{ x: 400, y: 20 }, "top"],
    [{ x: 780, y: 300 }, "right"],
    [{ x: 400, y: 580 }, "bottom"],
    [{ x: 20, y: 300 }, "left"],
  ] as const)("snaps a release near an edge to %s", (point, expectedDock) => {
    expect(
      getNearestNotebookToolbarDock({
        ...point,
        frameWidth: 800,
        frameHeight: 600,
        currentDock: "bottom",
      })
    ).toBe(expectedDock);
  });

  it("keeps the current dock within the hysteresis band", () => {
    expect(
      getNearestNotebookToolbarDock({
        x: 400,
        y: 288,
        frameWidth: 800,
        frameHeight: 600,
        currentDock: "bottom",
      })
    ).toBe("bottom");
  });

  it("uses vertical orientation only for side docks", () => {
    expect(isNotebookToolbarSideDock("left")).toBe(true);
    expect(isNotebookToolbarSideDock("right")).toBe(true);
    expect(isNotebookToolbarSideDock("top")).toBe(false);
    expect(isNotebookToolbarSideDock("bottom")).toBe(false);
  });

  it("stores one device-local dock preference across notebooks", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    saveNotebookToolbarDockPreference("left");
    expect(values.get(NOTEBOOK_TOOLBAR_DOCK_STORAGE_KEY)).toBe("left");
    expect(readNotebookToolbarDockPreference()).toBe("left");

    values.set(NOTEBOOK_TOOLBAR_DOCK_STORAGE_KEY, "center");
    expect(readNotebookToolbarDockPreference()).toBe("bottom");
  });
});
