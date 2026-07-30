// @vitest-environment jsdom

import {
  act,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import NotebookTextBlockOptions from "@/components/workspace/NotebookTextBlockOptions";
import { useNotebookPageState } from "@/hooks/useNotebookPageState";
import { useNotebookTextBlockController } from "@/hooks/useNotebookTextBlockController";
import { getNotebookTextBlockOptionsElementId } from "@/lib/workspace/notebook-page-content";
import {
  MAX_NOTEBOOK_TEXT_BLOCKS,
  type NotebookTextBlock,
} from "@/lib/workspace/notebooks";

type Controller = ReturnType<typeof useNotebookTextBlockController>;
type PointerInit = {
  clientX: number;
  clientY: number;
  pointerId?: number;
  pointerType?: string;
};
type HarnessProps = {
  editingEnabled?: boolean;
  initialBlocks?: NotebookTextBlock[];
  navigationLocked?: boolean;
  onChange: () => void;
  onCreateComplete: () => void;
  onCreateLimitReached: (maximum: number) => void;
  onGestureStart: () => void;
  onHistoryCommit: (
    previous: NotebookTextBlock[],
    next: NotebookTextBlock[]
  ) => void;
  onTouchPointerDown: (
    event: ReactPointerEvent<HTMLElement>
  ) => boolean;
  onTouchPointerEnd: (
    event: ReactPointerEvent<HTMLElement>,
    options?: { cancelled?: boolean }
  ) => boolean;
  onTouchPointerMove: (
    event: ReactPointerEvent<HTMLElement>
  ) => boolean;
  expose: (controller: Controller) => void;
};

const PAGE_RECT = {
  left: 20,
  top: 30,
  width: 450,
  height: 620,
};
const BASE_BLOCK: NotebookTextBlock = {
  id: "block-1",
  x: 100,
  y: 120,
  width: 300,
  height: 96,
  text: "Study note",
  outlineVisible: true,
};

let activeRoot: Root | null = null;
let capturedPointers: WeakMap<HTMLElement, Set<number>>;
let captureCalls: Array<{ element: HTMLElement; pointerId: number }>;
let animationFrameCallbacks: Map<number, FrameRequestCallback>;
let nextAnimationFrameId: number;

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalHasPointerCapture =
  HTMLElement.prototype.hasPointerCapture;
const originalSetPointerCapture =
  HTMLElement.prototype.setPointerCapture;
const originalReleasePointerCapture =
  HTMLElement.prototype.releasePointerCapture;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

function makeRect(input: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    bottom: input.top + input.height,
    height: input.height,
    left: input.left,
    right: input.left + input.width,
    top: input.top,
    width: input.width,
    x: input.left,
    y: input.top,
    toJSON: () => input,
  };
}

function cloneBlocks(blocks: NotebookTextBlock[]) {
  return blocks.map((block) => ({ ...block }));
}

function ControllerHarness({
  editingEnabled = true,
  initialBlocks = [],
  navigationLocked = false,
  onChange,
  onCreateComplete,
  onCreateLimitReached,
  onGestureStart,
  onHistoryCommit,
  onTouchPointerDown,
  onTouchPointerEnd,
  onTouchPointerMove,
  expose,
}: HarnessProps) {
  const { store: pageState, state: pageSnapshot } = useNotebookPageState();
  const textBlocks = pageSnapshot.textBlocks;
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const seededRef = useRef(false);

  useLayoutEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    pageState.setTextBlocks(cloneBlocks(initialBlocks));
  }, [initialBlocks, pageState]);

  const controller = useNotebookTextBlockController({
    editingEnabled,
    isNavigationLocked: () => navigationLocked,
    onChange,
    onCreateComplete,
    onCreateLimitReached,
    onGestureStart,
    onHistoryCommit,
    onTouchPointerDown,
    onTouchPointerEnd,
    onTouchPointerMove,
    pageSurfaceRef,
    pageState,
  });

  useLayoutEffect(() => {
    expose(controller);
  });

  return (
    <div>
      <div
        ref={pageSurfaceRef}
        data-notebook-page-surface="true"
        onPointerMove={controller.handlePageSurfaceTextGestureMove}
        onPointerUp={controller.handlePageSurfaceTextGestureStop}
        onPointerCancel={controller.handlePageSurfaceTextGestureStop}
      >
        {textBlocks.map((block) => {
          const selected =
            controller.selectedTextBlockId === block.id;
          const optionsOpen =
            controller.openTextBlockOptionsId === block.id;
          return (
            <div
              key={block.id}
              data-text-block-id={block.id}
              onPointerDown={(event) =>
                controller.handleTextBlockPointerDown(block, event)
              }
              onPointerMove={(event) =>
                controller.handleTextBlockPointerMove(block, event)
              }
              onPointerUp={(event) =>
                controller.handleTextBlockPointerUp(block, event)
              }
              onPointerCancel={(event) =>
                controller.handleTextBlockPointerCancel(block, event)
              }
              onClick={() =>
                controller.selectTextBlock(block.id)
              }
            >
              {selected ? (
                <NotebookTextBlockOptions
                  blockId={block.id}
                  open={optionsOpen}
                  outlineVisible={block.outlineVisible}
                  openAbove={false}
                  alignFromLeft
                  onOpenChange={(open) =>
                    controller.setTextBlockOptionsOpen(block.id, open)
                  }
                  onToggleOutline={() =>
                    controller.toggleTextBlockOutline(block.id)
                  }
                  onDelete={() =>
                    controller.deleteTextBlock(block.id)
                  }
                  onKeyDown={(event) =>
                    controller.handleTextBlockOptionsKeyDown(
                      block.id,
                      event
                    )
                  }
                />
              ) : null}
              <button
                type="button"
                data-resize-edge="right"
                onPointerDown={(event) =>
                  controller.startTextBlockResize(
                    block,
                    "right",
                    event
                  )
                }
                onPointerMove={controller.resizeTextBlock}
                onPointerUp={controller.stopTextBlockResize}
                onPointerCancel={controller.stopTextBlockResize}
              >
                Resize right
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" data-outside-control="true">
        Outside
      </button>
      <output data-block-state="true">
        {JSON.stringify(textBlocks)}
      </output>
    </div>
  );
}

function makeHarnessProps(
  overrides: Partial<HarnessProps> = {}
): Omit<HarnessProps, "expose"> {
  return {
    editingEnabled: true,
    initialBlocks: [],
    navigationLocked: false,
    onChange: vi.fn(),
    onCreateComplete: vi.fn(),
    onCreateLimitReached: vi.fn(),
    onGestureStart: vi.fn(),
    onHistoryCommit: vi.fn(),
    onTouchPointerDown: vi.fn(() => false),
    onTouchPointerEnd: vi.fn(() => false),
    onTouchPointerMove: vi.fn(() => false),
    ...overrides,
  };
}

function renderHarness(props: Omit<HarnessProps, "expose">) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  activeRoot = root;
  let currentController: Controller | null = null;

  act(() => {
    root.render(
      <ControllerHarness
        {...props}
        expose={(controller) => {
          currentController = controller;
        }}
      />
    );
  });

  return {
    block(blockId = "block-1") {
      return container.querySelector<HTMLElement>(
        `[data-text-block-id="${blockId}"]`
      )!;
    },
    blocks() {
      return JSON.parse(
        container.querySelector<HTMLOutputElement>(
          "[data-block-state='true']"
        )!.textContent ?? "[]"
      ) as NotebookTextBlock[];
    },
    controller() {
      expect(currentController).not.toBeNull();
      return currentController!;
    },
    outside() {
      return container.querySelector<HTMLButtonElement>(
        "[data-outside-control='true']"
      )!;
    },
    page() {
      return container.querySelector<HTMLElement>(
        "[data-notebook-page-surface='true']"
      )!;
    },
    resizeHandle(edge = "right") {
      return container.querySelector<HTMLButtonElement>(
        `[data-resize-edge="${edge}"]`
      )!;
    },
  };
}

function dispatchPointer(
  target: Element,
  type: string,
  init: PointerInit
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? "mouse" },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function dispatchKey(target: Element, key: string) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function flushAnimationFrames() {
  const callbacks = [...animationFrameCallbacks.values()];
  animationFrameCallbacks.clear();
  act(() => {
    for (const callback of callbacks) {
      callback(performance.now());
    }
  });
}

beforeAll(() => {
  Object.defineProperty(
    HTMLElement.prototype,
    "getBoundingClientRect",
    {
      configurable: true,
      value(this: HTMLElement) {
        if (this.dataset.notebookPageSurface === "true") {
          return makeRect(PAGE_RECT);
        }
        return makeRect({ left: 0, top: 0, width: 0, height: 0 });
      },
    }
  );
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value(this: HTMLElement, pointerId: number) {
      return capturedPointers.get(this)?.has(pointerId) ?? false;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value(this: HTMLElement, pointerId: number) {
      const pointers =
        capturedPointers.get(this) ?? new Set<number>();
      pointers.add(pointerId);
      capturedPointers.set(this, pointers);
      captureCalls.push({ element: this, pointerId });
    },
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value(this: HTMLElement, pointerId: number) {
      capturedPointers.get(this)?.delete(pointerId);
    },
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value(callback: FrameRequestCallback) {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrameCallbacks.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value(id: number) {
      animationFrameCallbacks.delete(id);
    },
  });
});

beforeEach(() => {
  capturedPointers = new WeakMap();
  captureCalls = [];
  animationFrameCallbacks = new Map();
  nextAnimationFrameId = 1;
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
    activeRoot = null;
  }
  document.body.replaceChildren();
});

afterAll(() => {
  Object.defineProperty(
    HTMLElement.prototype,
    "getBoundingClientRect",
    {
      configurable: true,
      value: originalGetBoundingClientRect,
    }
  );
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: originalHasPointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: originalSetPointerCapture,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: originalReleasePointerCapture,
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelAnimationFrame,
  });
});

describe("useNotebookTextBlockController", () => {
  it("creates a centered block and commits its initial history", () => {
    const props = makeHarnessProps();
    const harness = renderHarness(props);

    act(() => {
      harness.controller().createTextBlockAtPoint({
        x: 450,
        y: 620,
      });
    });

    const [block] = harness.blocks();
    expect(block).toMatchObject({
      x: 330,
      y: 584,
      width: 300,
      height: 96,
      text: "",
      outlineVisible: true,
    });
    expect(harness.controller().selectedTextBlockId).toBe(block?.id);
    expect(harness.controller().editingTextBlockId).toBe(block?.id);
    expect(harness.controller().openTextBlockOptionsId).toBeNull();
    expect(props.onHistoryCommit).toHaveBeenCalledWith([], [
      expect.objectContaining({ id: block?.id }),
    ]);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onCreateComplete).toHaveBeenCalledOnce();
    expect(props.onCreateLimitReached).not.toHaveBeenCalled();
  });

  it("rejects creation at the per-page text-block maximum", () => {
    const initialBlocks = Array.from(
      { length: MAX_NOTEBOOK_TEXT_BLOCKS },
      (_, index): NotebookTextBlock => ({
        ...BASE_BLOCK,
        id: `block-${index}`,
      })
    );
    const props = makeHarnessProps({ initialBlocks });
    const harness = renderHarness(props);

    act(() => {
      harness.controller().createTextBlockAtPoint({ x: 300, y: 300 });
    });

    expect(harness.blocks()).toHaveLength(MAX_NOTEBOOK_TEXT_BLOCKS);
    expect(props.onCreateLimitReached).toHaveBeenCalledOnce();
    expect(props.onCreateLimitReached).toHaveBeenCalledWith(
      MAX_NOTEBOOK_TEXT_BLOCKS
    );
    expect(props.onCreateComplete).not.toHaveBeenCalled();
    expect(props.onHistoryCommit).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("selects on the first tap and edits only a second strict-under-6px pointerup", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 2,
    });
    dispatchPointer(harness.block(), "pointerup", {
      clientX: 100,
      clientY: 100,
      pointerId: 2,
    });
    expect(harness.controller().selectedTextBlockId).toBe(BASE_BLOCK.id);
    expect(harness.controller().editingTextBlockId).toBeNull();

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 3,
    });
    dispatchPointer(harness.block(), "pointerup", {
      clientX: 105,
      clientY: 105,
      pointerId: 3,
    });
    expect(harness.controller().editingTextBlockId).toBe(BASE_BLOCK.id);

    act(() => {
      harness.controller().stopEditingTextBlock();
    });
    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 4,
    });
    dispatchPointer(harness.block(), "pointerup", {
      clientX: 106,
      clientY: 100,
      pointerId: 4,
    });
    expect(harness.controller().editingTextBlockId).toBeNull();

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 5,
    });
    dispatchPointer(harness.block(), "pointercancel", {
      clientX: 100,
      clientY: 100,
      pointerId: 5,
    });
    expect(harness.controller().editingTextBlockId).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onHistoryCommit).not.toHaveBeenCalled();
  });

  it("delegates an unselected touch, then uses the controller once selected", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 12,
      pointerType: "touch",
    });
    dispatchPointer(harness.block(), "pointermove", {
      clientX: 104,
      clientY: 103,
      pointerId: 12,
      pointerType: "touch",
    });
    dispatchPointer(harness.block(), "pointerup", {
      clientX: 104,
      clientY: 103,
      pointerId: 12,
      pointerType: "touch",
    });

    expect(props.onTouchPointerDown).toHaveBeenCalledOnce();
    expect(props.onTouchPointerMove).toHaveBeenCalledOnce();
    expect(props.onTouchPointerEnd).toHaveBeenCalledOnce();
    expect(props.onGestureStart).not.toHaveBeenCalled();

    act(() => harness.block().click());
    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 13,
      pointerType: "touch",
    });
    dispatchPointer(harness.block(), "pointerup", {
      clientX: 100,
      clientY: 100,
      pointerId: 13,
      pointerType: "touch",
    });

    expect(props.onTouchPointerDown).toHaveBeenCalledOnce();
    expect(props.onTouchPointerEnd).toHaveBeenCalledOnce();
    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(harness.controller().editingTextBlockId).toBe(BASE_BLOCK.id);
  });

  it("maps drag movement into page coordinates and commits history once", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 6,
    });
    dispatchPointer(harness.page(), "pointermove", {
      clientX: 145,
      clientY: 162,
      pointerId: 6,
    });

    expect(harness.blocks()[0]).toMatchObject({
      x: 190,
      y: 244,
    });
    expect(harness.controller().activeTextGestureId).toBe(BASE_BLOCK.id);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).not.toHaveBeenCalled();

    dispatchPointer(harness.page(), "pointerup", {
      clientX: 145,
      clientY: 162,
      pointerId: 6,
    });

    expect(harness.controller().activeTextGestureId).toBeNull();
    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).toHaveBeenCalledWith(
      [expect.objectContaining({ x: 100, y: 120 })],
      [expect.objectContaining({ x: 190, y: 244 })]
    );
  });

  it("keeps an active gesture owned by its original pointer", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 20,
    });
    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 180,
      clientY: 180,
      pointerId: 21,
    });
    dispatchPointer(harness.page(), "pointermove", {
      clientX: 225,
      clientY: 242,
      pointerId: 21,
    });
    dispatchPointer(harness.page(), "pointerup", {
      clientX: 225,
      clientY: 242,
      pointerId: 21,
    });

    expect(harness.blocks()).toEqual([BASE_BLOCK]);
    expect(harness.controller().activeTextGestureId).toBe(BASE_BLOCK.id);
    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).not.toHaveBeenCalled();

    dispatchPointer(harness.page(), "pointermove", {
      clientX: 145,
      clientY: 162,
      pointerId: 20,
    });
    dispatchPointer(harness.page(), "pointerup", {
      clientX: 145,
      clientY: 162,
      pointerId: 20,
    });

    expect(harness.blocks()[0]).toMatchObject({ x: 190, y: 244 });
    expect(harness.controller().activeTextGestureId).toBeNull();
    expect(props.onHistoryCommit).toHaveBeenCalledOnce();
  });

  it("resizes from the original geometry and commits one final snapshot", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.resizeHandle(), "pointerdown", {
      clientX: 400,
      clientY: 200,
      pointerId: 7,
    });
    dispatchPointer(harness.page(), "pointermove", {
      clientX: 445,
      clientY: 200,
      pointerId: 7,
    });

    expect(harness.blocks()[0]).toMatchObject({
      x: 100,
      width: 390,
    });
    expect(captureCalls.map(({ pointerId }) => pointerId)).toEqual([
      7,
      7,
    ]);
    expect(props.onHistoryCommit).not.toHaveBeenCalled();

    dispatchPointer(harness.page(), "pointerup", {
      clientX: 445,
      clientY: 200,
      pointerId: 7,
    });

    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).toHaveBeenCalledWith(
      [expect.objectContaining({ width: 300 })],
      [expect.objectContaining({ width: 390 })]
    );
  });

  it.each([
    { editingEnabled: false, navigationLocked: false },
    { editingEnabled: true, navigationLocked: true },
  ])(
    "guards gestures when editingEnabled=$editingEnabled and navigationLocked=$navigationLocked",
    ({ editingEnabled, navigationLocked }) => {
      const props = makeHarnessProps({
        editingEnabled,
        initialBlocks: [BASE_BLOCK],
        navigationLocked,
      });
      const harness = renderHarness(props);

      dispatchPointer(harness.block(), "pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerId: 8,
      });
      dispatchPointer(harness.page(), "pointermove", {
        clientX: 180,
        clientY: 180,
        pointerId: 8,
      });
      dispatchPointer(harness.page(), "pointerup", {
        clientX: 180,
        clientY: 180,
        pointerId: 8,
      });

      expect(harness.blocks()).toEqual([BASE_BLOCK]);
      expect(harness.controller().selectedTextBlockId).toBeNull();
      expect(harness.controller().activeTextGestureId).toBeNull();
      expect(captureCalls).toHaveLength(0);
      expect(props.onGestureStart).not.toHaveBeenCalled();
      expect(props.onChange).not.toHaveBeenCalled();
      expect(props.onHistoryCommit).not.toHaveBeenCalled();
    }
  );

  it("resets transient state and makes late gesture events harmless", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 9,
    });
    act(() => {
      harness.controller().setTextBlockOptionsOpen(BASE_BLOCK.id, true);
      harness.controller().resetTextBlockInteraction();
    });

    expect(harness.controller().selectedTextBlockId).toBeNull();
    expect(harness.controller().editingTextBlockId).toBeNull();
    expect(harness.controller().openTextBlockOptionsId).toBeNull();
    expect(harness.controller().activeTextGestureId).toBeNull();
    expect(harness.block().hasPointerCapture(9)).toBe(false);

    dispatchPointer(harness.page(), "pointermove", {
      clientX: 200,
      clientY: 200,
      pointerId: 9,
    });
    dispatchPointer(harness.page(), "pointerup", {
      clientX: 200,
      clientY: 200,
      pointerId: 9,
    });

    expect(harness.blocks()).toEqual([BASE_BLOCK]);
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onHistoryCommit).not.toHaveBeenCalled();
  });

  it("finishes an interrupted moved gesture with one undo snapshot", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    dispatchPointer(harness.block(), "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId: 22,
    });
    dispatchPointer(harness.page(), "pointermove", {
      clientX: 145,
      clientY: 162,
      pointerId: 22,
    });
    act(() => harness.controller().finishActiveTextBlockGesture());

    expect(harness.controller().activeTextGestureId).toBeNull();
    expect(harness.block().hasPointerCapture(22)).toBe(false);
    expect(props.onHistoryCommit).toHaveBeenCalledOnce();

    dispatchPointer(harness.page(), "pointerup", {
      clientX: 145,
      clientY: 162,
      pointerId: 22,
    });
    expect(props.onHistoryCommit).toHaveBeenCalledOnce();
  });

  it("exits another block's editor when touch selects a different block", () => {
    const secondBlock: NotebookTextBlock = {
      ...BASE_BLOCK,
      id: "block-2",
      x: 440,
    };
    const props = makeHarnessProps({
      initialBlocks: [BASE_BLOCK, secondBlock],
    });
    const harness = renderHarness(props);

    act(() =>
      harness.controller().startEditingTextBlock(BASE_BLOCK.id)
    );
    dispatchPointer(harness.block(secondBlock.id), "pointerdown", {
      clientX: 300,
      clientY: 300,
      pointerId: 23,
      pointerType: "touch",
    });
    dispatchPointer(harness.block(secondBlock.id), "pointerup", {
      clientX: 300,
      clientY: 300,
      pointerId: 23,
      pointerType: "touch",
    });
    act(() => harness.block(secondBlock.id).click());

    expect(props.onTouchPointerDown).toHaveBeenCalledOnce();
    expect(props.onTouchPointerEnd).toHaveBeenCalledOnce();
    expect(harness.controller().selectedTextBlockId).toBe(secondBlock.id);
    expect(harness.controller().editingTextBlockId).toBeNull();
  });

  it("updates, toggles, and deletes with the expected history semantics", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    act(() => {
      harness.controller().updateTextBlock(BASE_BLOCK.id, {
        width: 20,
        x: -50,
      });
    });
    expect(harness.blocks()[0]).toMatchObject({ width: 120, x: 0 });
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onHistoryCommit).not.toHaveBeenCalled();

    act(() => {
      harness.controller().toggleTextBlockOutline(BASE_BLOCK.id);
    });
    expect(harness.blocks()[0]?.outlineVisible).toBe(false);
    expect(props.onHistoryCommit).toHaveBeenCalledOnce();

    act(() => {
      harness.controller().startEditingTextBlock(BASE_BLOCK.id);
      harness.controller().setTextBlockOptionsOpen(BASE_BLOCK.id, true);
      harness.controller().deleteTextBlock(BASE_BLOCK.id);
    });
    expect(harness.blocks()).toEqual([]);
    expect(harness.controller().selectedTextBlockId).toBeNull();
    expect(harness.controller().editingTextBlockId).toBeNull();
    expect(harness.controller().openTextBlockOptionsId).toBeNull();
    expect(props.onHistoryCommit).toHaveBeenCalledTimes(2);
    expect(props.onChange).toHaveBeenCalledTimes(3);
  });

  it("manages options focus, keyboard navigation, and outside dismissal", () => {
    const props = makeHarnessProps({ initialBlocks: [BASE_BLOCK] });
    const harness = renderHarness(props);

    act(() => {
      harness.controller().selectTextBlock(BASE_BLOCK.id);
      harness.controller().setTextBlockOptionsOpen(BASE_BLOCK.id, true);
    });
    flushAnimationFrames();

    const menuId = getNotebookTextBlockOptionsElementId(
      BASE_BLOCK.id,
      "menu"
    );
    const triggerId = getNotebookTextBlockOptionsElementId(
      BASE_BLOCK.id,
      "trigger"
    );
    const menu = document.getElementById(menuId)!;
    const menuItems = menu.querySelectorAll<HTMLElement>(
      '[role="menuitemcheckbox"], [role="menuitem"]'
    );
    expect(document.activeElement).toBe(menuItems[0]);

    dispatchKey(menu, "ArrowDown");
    expect(document.activeElement).toBe(menuItems[1]);
    dispatchKey(menu, "ArrowDown");
    expect(document.activeElement).toBe(menuItems[0]);
    dispatchKey(menu, "End");
    expect(document.activeElement).toBe(menuItems[1]);
    dispatchKey(menu, "Home");
    expect(document.activeElement).toBe(menuItems[0]);
    dispatchKey(menu, "ArrowUp");
    expect(document.activeElement).toBe(menuItems[1]);

    const escapeEvent = dispatchKey(menu, "Escape");
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(harness.controller().openTextBlockOptionsId).toBeNull();
    flushAnimationFrames();
    expect(document.activeElement).toBe(
      document.getElementById(triggerId)
    );

    act(() => {
      harness.controller().setTextBlockOptionsOpen(BASE_BLOCK.id, true);
    });
    flushAnimationFrames();
    const reopenedMenu = document.getElementById(menuId)!;
    const tabEvent = dispatchKey(reopenedMenu, "Tab");
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(harness.controller().openTextBlockOptionsId).toBeNull();

    act(() => {
      harness.controller().setTextBlockOptionsOpen(BASE_BLOCK.id, true);
    });
    flushAnimationFrames();
    dispatchPointer(
      document.querySelector("[role='menuitemcheckbox']")!,
      "pointerdown",
      {
        clientX: 100,
        clientY: 100,
        pointerId: 10,
      }
    );
    expect(harness.controller().openTextBlockOptionsId).toBe(
      BASE_BLOCK.id
    );

    dispatchPointer(harness.outside(), "pointerdown", {
      clientX: 500,
      clientY: 500,
      pointerId: 11,
    });
    expect(harness.controller().openTextBlockOptionsId).toBeNull();
  });
});
