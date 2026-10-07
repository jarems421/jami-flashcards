// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeckObjectCard from "@/components/workspace/DeckObjectCard";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";

/**
 * Holding a deck or notebook card on a phone opens its actions, and the tap
 * the release would make does not also open the card.
 */

let container: HTMLDivElement;
let root: Root;
let phone = true;

function pointer(target: Element, type: string, init: { x: number; y: number; kind?: string }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 1 },
    pointerType: { value: init.kind ?? "touch" },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function click(target: Element) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const sheet = () => document.querySelector("[data-mobile-object-actions]");
const deckLink = () => container.querySelector("a")!;

function renderDeck(onRemove = vi.fn()) {
  act(() => {
    root.render(
      <DeckObjectCard title="Cell biology" href="/deck/d1" onRemoveFromFolder={onRemove} />
    );
  });
  return onRemove;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  phone = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("holding a card on a phone", () => {
  it("opens its actions, and the release does not open the card", () => {
    renderDeck();
    pointer(deckLink(), "pointerdown", { x: 20, y: 20 });
    act(() => vi.advanceTimersByTime(550));

    expect(sheet()).not.toBeNull();
    expect(click(deckLink()).defaultPrevented).toBe(true);
    // Only the one tap the hold left behind is swallowed.
    expect(click(deckLink()).defaultPrevented).toBe(false);
  });

  it("is a tap when let go sooner", () => {
    renderDeck();
    pointer(deckLink(), "pointerdown", { x: 20, y: 20 });
    act(() => vi.advanceTimersByTime(400));
    pointer(deckLink(), "pointerup", { x: 20, y: 20 });
    act(() => vi.advanceTimersByTime(400));

    expect(sheet()).toBeNull();
    expect(click(deckLink()).defaultPrevented).toBe(false);
  });

  it("is a scroll when the finger moves", () => {
    renderDeck();
    pointer(deckLink(), "pointerdown", { x: 20, y: 20 });
    pointer(deckLink(), "pointermove", { x: 20, y: 40 });
    act(() => vi.advanceTimersByTime(600));

    expect(sheet()).toBeNull();
  });

  it("leaves a mouse alone, and a wider screen", () => {
    renderDeck();
    pointer(deckLink(), "pointerdown", { x: 20, y: 20, kind: "mouse" });
    act(() => vi.advanceTimersByTime(600));
    expect(sheet()).toBeNull();

    phone = false;
    pointer(deckLink(), "pointerdown", { x: 20, y: 20 });
    act(() => vi.advanceTimersByTime(600));
    expect(sheet()).toBeNull();
  });

  it("lets the sheet's own buttons act", () => {
    const onRemove = renderDeck();
    pointer(deckLink(), "pointerdown", { x: 20, y: 20 });
    act(() => vi.advanceTimersByTime(550));

    const remove = [...sheet()!.querySelectorAll("button")].find(
      (button) => button.textContent === "Remove from folder"
    )!;
    click(remove);

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("works the same on a notebook card", () => {
    const onDelete = vi.fn();
    act(() => {
      root.render(
        <NotebookObjectCard
          href="/dashboard/notebooks/n1"
          title="Cells"
          typeLabel="notebook"
          pageColor="white"
          pageStyle="lined"
          onDelete={onDelete}
        />
      );
    });
    const link = container.querySelector("a")!;
    pointer(link, "pointerdown", { x: 20, y: 20 });
    act(() => vi.advanceTimersByTime(550));

    expect(sheet()?.getAttribute("data-mobile-object-actions")).toBe("notebook");
    expect(click(link).defaultPrevented).toBe(true);
  });
});
