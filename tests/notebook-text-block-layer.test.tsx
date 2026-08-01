// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookTextBlockLayer } from "@/components/workspace/NotebookTextBlockLayer";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  type NotebookPageColor,
  type NotebookTextBlock,
} from "@/lib/workspace/notebooks";

let container: HTMLDivElement;
let root: Root;

const handlers = {
  onPointerDown: vi.fn(),
  onPointerMove: vi.fn(),
  onPointerUp: vi.fn(),
  onPointerCancel: vi.fn(),
  onSelect: vi.fn(),
  onSetOptionsOpen: vi.fn(),
  onToggleOutline: vi.fn(),
  onDelete: vi.fn(),
  onOptionsKeyDown: vi.fn(),
  onStartResize: vi.fn(),
  onResize: vi.fn(),
  onStopResize: vi.fn(),
  onChangeText: vi.fn(),
  onStopEditing: vi.fn(),
};

function block(over: Partial<NotebookTextBlock> = {}): NotebookTextBlock {
  return {
    id: "block-1",
    x: 90,
    y: 124,
    width: 300,
    height: 96,
    text: "Study note",
    outlineVisible: true,
    ...over,
  } as NotebookTextBlock;
}

function render(
  over: Partial<{
    textBlocks: NotebookTextBlock[];
    pageColor: NotebookPageColor;
    editingEnabled: boolean;
    selectedTextBlockId: string | null;
    editingTextBlockId: string | null;
    activeTextGestureId: string | null;
    openTextBlockOptionsId: string | null;
  }> = {}
) {
  act(() => {
    root.render(
      <NotebookTextBlockLayer
        textBlocks={over.textBlocks ?? [block()]}
        pageColor={over.pageColor ?? "white"}
        editingEnabled={over.editingEnabled ?? true}
        selectedTextBlockId={over.selectedTextBlockId ?? null}
        editingTextBlockId={over.editingTextBlockId ?? null}
        activeTextGestureId={over.activeTextGestureId ?? null}
        openTextBlockOptionsId={over.openTextBlockOptionsId ?? null}
        {...handlers}
      />
    );
  });
}

const resizeHandles = () =>
  container.querySelectorAll('[data-text-resize-handle="true"]');
const editor = () =>
  container.querySelector<HTMLTextAreaElement>(
    '[data-notebook-text-editor="true"]'
  );
const blockEl = () =>
  container.querySelector<HTMLElement>(".notebook-text-object");

beforeEach(() => {
  Object.values(handlers).forEach((fn) => fn.mockClear());
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

describe("NotebookTextBlockLayer", () => {
  it("places a block as a percentage of the page, so zoom cannot move it", () => {
    render();
    const el = blockEl()!;
    expect(el.style.left).toBe(`${(90 / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`);
    expect(el.style.top).toBe(`${(124 / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`);
  });

  it("shows no chrome until a block is selected", () => {
    render();
    expect(resizeHandles()).toHaveLength(0);
    expect(editor()).toBeNull();
  });

  it("shows resize handles on every edge once selected", () => {
    render({ selectedTextBlockId: "block-1" });
    expect(resizeHandles()).toHaveLength(4);
  });

  it("hides the chrome mid-gesture so it cannot fight the drag", () => {
    render({ selectedTextBlockId: "block-1", activeTextGestureId: "block-1" });
    expect(resizeHandles()).toHaveLength(0);
  });

  it("offers no chrome at all in read-only mode", () => {
    render({ selectedTextBlockId: "block-1", editingEnabled: false });
    expect(resizeHandles()).toHaveLength(0);
    render({ editingTextBlockId: "block-1", editingEnabled: false });
    expect(editor()).toBeNull();
  });

  it("swaps the block for a textarea while editing", () => {
    render({ selectedTextBlockId: "block-1", editingTextBlockId: "block-1" });
    expect(editor()?.value).toBe("Study note");
  });

  it("reports typing without owning the text", () => {
    render({ selectedTextBlockId: "block-1", editingTextBlockId: "block-1" });
    const field = editor()!;
    act(() => {
      // React keeps its own value tracker, so assigning `.value` directly is
      // swallowed. Go through the native setter to make the change look real.
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set?.call(field, "Updated note");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(handlers.onChangeText).toHaveBeenCalledWith("block-1", "Updated note");
  });

  it("leaves editing on Escape", () => {
    render({ selectedTextBlockId: "block-1", editingTextBlockId: "block-1" });
    act(() => {
      editor()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(handlers.onStopEditing).toHaveBeenCalledTimes(1);
  });

  it("keeps typing gestures from reaching the drag handler beneath", () => {
    render({ selectedTextBlockId: "block-1", editingTextBlockId: "block-1" });
    act(() => {
      editor()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    // The block below must not read a caret placement as the start of a drag.
    expect(handlers.onPointerDown).not.toHaveBeenCalled();
  });

  it("starts a resize from the edge that was grabbed", () => {
    render({ selectedTextBlockId: "block-1" });
    const right = [...resizeHandles()].find(
      (el) => el.getAttribute("aria-label") === "Resize text box from right edge"
    )!;
    act(() => {
      right.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(handlers.onStartResize).toHaveBeenCalledTimes(1);
    expect(handlers.onStartResize.mock.calls[0]?.[1]).toBe("right");
  });

  it("prompts an empty selected block rather than looking broken", () => {
    render({ textBlocks: [block({ text: "  " })], selectedTextBlockId: "block-1" });
    expect(container.textContent).toContain("Tap again to type");
    // An empty block nobody has selected stays silent.
    render({ textBlocks: [block({ text: "  " })], selectedTextBlockId: null });
    expect(container.textContent).not.toContain("Tap again to type");
  });

  it("inverts text for a black page", () => {
    render({ pageColor: "black" });
    expect(blockEl()!.querySelector("button")?.className).toContain("#f8fafc");
    render({ pageColor: "white" });
    expect(blockEl()!.querySelector("button")?.className).toContain("text-slate-950");
  });

  it("uses a keyboard-focusable control to select a text box", () => {
    render();
    const selectButton = blockEl()!.querySelector<HTMLButtonElement>(
      'button[aria-label^="Select text box"]'
    );

    expect(selectButton).not.toBeNull();
    act(() => selectButton!.click());
    expect(handlers.onSelect).toHaveBeenCalledWith("block-1");
  });

  it("drops the idle outline when the block asks to hide it", () => {
    render({ textBlocks: [block({ outlineVisible: false })] });
    expect(blockEl()!.className).toContain("border-transparent");
    render({ textBlocks: [block({ outlineVisible: true })] });
    expect(blockEl()!.className).not.toContain("border-transparent");
  });
});
