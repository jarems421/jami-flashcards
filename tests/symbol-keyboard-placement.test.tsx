// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SymbolKeyboard from "@/components/ui/SymbolKeyboard";

/**
 * Which way the maths keyboard opens.
 *
 * Near the bottom of the window it opens upward -- unless the card around the
 * field clips it there. It used to measure the window alone, so on a deck page
 * it opened up into the top edge of the Add cards panel and was mostly cut off.
 */

type Box = { top: number; bottom: number };

let root: Root;
let host: HTMLDivElement;
const boxes = new Map<Element, Box>();

function rect({ top, bottom }: Box) {
  return { top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rect(boxes.get(this) ?? boxes.get(this.closest("[data-field]")!) ?? { top: 0, bottom: 0 });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  boxes.clear();
  vi.restoreAllMocks();
});

/** A field 257px above the window's bottom edge, in a card that starts 116px above it. */
function mountInCard(clips: boolean) {
  const ref = createRef<HTMLInputElement>();
  act(() => {
    root.render(
      <div data-card style={clips ? { overflowY: "hidden" } : undefined}>
        <div data-field>
          <input ref={ref} />
          <SymbolKeyboard targetRef={ref} />
        </div>
      </div>
    );
  });
  boxes.set(host.querySelector("[data-card]")!, { top: 472, bottom: 1400 });
  boxes.set(host.querySelector("[data-field]")!, { top: 588, bottom: 643 });
  act(() => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Maths symbols"]')!.click();
  });
  return host.querySelector('[role="dialog"][aria-label="Maths symbols"]')!;
}

describe("the maths keyboard's direction", () => {
  it("opens upward near the bottom of the window when nothing clips it", () => {
    expect(mountInCard(false).className).toContain("bottom-9");
  });

  it("opens downward when the card around it would cut it off above", () => {
    expect(mountInCard(true).className).toContain("top-9");
  });
});
