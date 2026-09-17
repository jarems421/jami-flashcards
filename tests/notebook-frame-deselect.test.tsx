// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotebookViewport from "@/components/workspace/NotebookViewport";

declare global {
  // React only treats a test as an act() environment when this is set.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

const GEOMETRY = {
  pageWidth: 450,
  pageHeight: 620,
  pageX: 100,
  pageY: 16,
  swipeTravel: 466,
};

function render(activeContent: React.ReactNode, onFramePointerDown: () => void) {
  act(() => {
    root.render(
      <NotebookViewport
        activeClassName="bg-white"
        activeContent={activeContent}
        activeRef={createRef<HTMLDivElement>()}
        frameRef={createRef<HTMLDivElement>()}
        geometry={GEOMETRY}
        onActivePointerCancel={() => undefined}
        onActivePointerMove={() => undefined}
        onActivePointerUp={() => undefined}
        onFramePointerDown={onFramePointerDown}
        onTrackTransitionCancel={() => undefined}
        onTrackTransitionEnd={() => undefined}
        previewLayerRef={createRef<HTMLDivElement>()}
        trackRef={createRef<HTMLDivElement>()}
      />
    );
  });
}

const pointerDown = (element: Element) =>
  act(() => {
    element.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true })
    );
  });

function find(selector: string) {
  const found = container.querySelector(selector);
  if (!found) throw new Error(`Nothing matched ${selector}.`);
  return found;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

describe("tapping the page frame", () => {
  it("reports a tap on the margin around the sheet", () => {
    // The sheet does not fill the frame -- on a wide window or a zoomed-out
    // page there is a margin all round it, and nothing used to be listening
    // out there, so a selected image kept its handles up.
    const onFramePointerDown = vi.fn();
    render(<span>page</span>, onFramePointerDown);

    pointerDown(find("[data-notebook-page-frame]"));
    expect(onFramePointerDown).toHaveBeenCalledTimes(1);
  });

  it("reports a tap that lands on the page itself", () => {
    // Unconditional on purpose: a gap in the coverage below should let go of
    // the selection rather than strand it.
    const onFramePointerDown = vi.fn();
    render(<span data-testid="page-body">page</span>, onFramePointerDown);

    pointerDown(find('[data-testid="page-body"]'));
    expect(onFramePointerDown).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way of anything that is being picked up", () => {
    /*
     * The contract every placed layer already follows: a text box, an image or
     * a graph stops the event as it takes the pointer, so picking one up does
     * not immediately drop it again on the way past.
     */
    const onFramePointerDown = vi.fn();
    render(
      <button
        type="button"
        data-testid="placed-item"
        onPointerDown={(event) => event.stopPropagation()}
      >
        image
      </button>,
      onFramePointerDown
    );

    pointerDown(find('[data-testid="placed-item"]'));
    expect(onFramePointerDown).not.toHaveBeenCalled();
  });
});
