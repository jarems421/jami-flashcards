import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampNotebookToolbarDragOffset,
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
    expect(hasNotebookToolbarDragStarted({ deltaX: 4, deltaY: 5 })).toBe(false);
    expect(hasNotebookToolbarDragStarted({ deltaX: 8, deltaY: 0 })).toBe(true);
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
