// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotebookDrawingToolbar,
  type NotebookToolMenu,
} from "@/components/workspace/NotebookDrawingToolbar";
import type { NotebookToolbarDock } from "@/lib/workspace/notebook-toolbar";
import type { NotebookEditorTool } from "@/lib/workspace/notebook-page-state";

let container: HTMLDivElement;
let root: Root;

const onSelectDrawingTool = vi.fn();
const onToggleTextTool = vi.fn();
const onUndo = vi.fn();
const onRedo = vi.fn();

function render(
  overrides: Partial<{
    dock: NotebookToolbarDock;
    tool: NotebookEditorTool;
    openMenu: NotebookToolMenu;
    undoDepth: number;
    redoDepth: number;
  }> = {}
) {
  act(() => {
    root.render(
      <NotebookDrawingToolbar
        dock={overrides.dock ?? "bottom"}
        toolbarRef={null}
        dockBindings={{}}
        tool={overrides.tool ?? "pen"}
        penColor="black"
        highlighterColor="yellow"
        openMenu={overrides.openMenu ?? null}
        onSelectDrawingTool={onSelectDrawingTool}
        onToggleTextTool={onToggleTextTool}
        undoDepth={overrides.undoDepth ?? 0}
        redoDepth={overrides.redoDepth ?? 0}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    );
  });
}

function button(label: string) {
  const el = container.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`
  );
  if (!el) throw new Error(`no button labelled ${label}`);
  return el;
}

function click(label: string) {
  act(() => {
    button(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  onSelectDrawingTool.mockClear();
  onToggleTextTool.mockClear();
  onUndo.mockClear();
  onRedo.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("NotebookDrawingToolbar", () => {
  it("reports which drawing tool was pressed", () => {
    render();
    click("Pen (P)");
    click("Highlighter (H)");
    click("Eraser (E)");
    expect(onSelectDrawingTool.mock.calls.map(([t]) => t)).toEqual([
      "pen",
      "highlighter",
      "eraser",
    ]);
  });

  it("marks the active tool, and its button while its menu is open", () => {
    render({ tool: "pen" });
    expect(button("Pen (P)").dataset.active).toBe("true");

    // The eraser reads active while its options are showing, even though the
    // pen is still the selected tool.
    render({ tool: "pen", openMenu: "eraser" });
    expect(button("Eraser (E)").dataset.active).toBe("true");
    expect(button("Highlighter (H)").dataset.active).not.toBe("true");
  });

  it("exposes which tool settings popover is expanded", () => {
    render({ openMenu: "highlighter" });
    expect(button("Pen (P)").getAttribute("aria-expanded")).toBe("false");
    expect(button("Highlighter (H)").getAttribute("aria-expanded")).toBe(
      "true"
    );
    expect(button("Eraser (E)").getAttribute("aria-expanded")).toBe("false");
    expect(button("Highlighter (H)").getAttribute("aria-controls")).toBe(
      "notebook-tool-settings"
    );
  });

  it("disables undo and redo only when nothing is left to step", () => {
    render({ undoDepth: 0, redoDepth: 0 });
    expect(button("Undo (Ctrl+Z)").disabled).toBe(true);
    expect(button("Redo (Ctrl+Shift+Z)").disabled).toBe(true);

    render({ undoDepth: 1, redoDepth: 2 });
    expect(button("Undo (Ctrl+Z)").disabled).toBe(false);
    expect(button("Redo (Ctrl+Shift+Z)").disabled).toBe(false);

    click("Undo (Ctrl+Z)");
    click("Redo (Ctrl+Shift+Z)");
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("keeps side docks clear of the device safe area", () => {
    for (const dock of ["left", "right"] as const) {
      render({ dock });
      const positioned = container.firstElementChild as HTMLElement;
      // A dock under the notch is invisible to every automated check, so the
      // inset is pinned here.
      expect(positioned.className).toContain("env(safe-area-inset-");
    }
  });

  it("switches orientation when docked to a side", () => {
    render({ dock: "bottom" });
    let bar = container.querySelector('[role="toolbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-orientation")).toBe("horizontal");

    render({ dock: "left" });
    bar = container.querySelector('[role="toolbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    expect(bar.className).toContain("flex-col");
  });

  it("exposes the dock edge for the docking controller to read back", () => {
    render({ dock: "top" });
    const bar = container.querySelector('[role="toolbar"]') as HTMLElement;
    expect(bar.dataset.toolbarDock).toBe("top");
  });
});
