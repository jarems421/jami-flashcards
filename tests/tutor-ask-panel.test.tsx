// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorAskPanel from "@/components/ai/TutorAskPanel";
import TutorSourcePicker from "@/components/ai/TutorSourcePicker";
import type { Source } from "@/lib/material/sources";

/**
 * Asking Jami from the Tutor page: the question and the material together,
 * one source or several, with the chat's own three starting points.
 */

function source(id: string, title: string, updatedAt: number): Source {
  return {
    id,
    title,
    type: "text",
    folderIds: [],
    topicIds: [],
    status: "active",
    createdBy: "u1",
    createdAt: 0,
    updatedAt,
  } as unknown as Source;
}

const SOURCES = [
  source("bio", "Enzymes notes", 3),
  source("chem", "Titrations worksheet", 2),
  source("phys", "Forces lecture", 1),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found as HTMLButtonElement;
}

function checkbox(title: string) {
  const label = [...container.querySelectorAll("label")].find((entry) => entry.textContent?.includes(title));
  return label?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

describe("choosing the material", () => {
  it("adds several sources, and never lets the last one go", () => {
    const onChange = vi.fn();
    act(() => root.render(<TutorSourcePicker sources={SOURCES} selectedIds={["bio"]} onChange={onChange} />));

    // One source in use: no way to remove it, because a chat reads something.
    expect(container.querySelector('[aria-label="Stop using Enzymes notes"]')).toBeNull();

    act(() => button("+ Add more").click());
    // Most recent first, and the one in use cannot be unticked while it is alone.
    expect(checkbox("Enzymes notes")?.disabled).toBe(true);
    act(() => checkbox("Titrations worksheet")!.click());
    expect(onChange).toHaveBeenCalledWith(["bio", "chem"]);
  });

  it("removes one of several", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(<TutorSourcePicker sources={SOURCES} selectedIds={["bio", "chem"]} onChange={onChange} />)
    );
    act(() => button("Stop using Titrations worksheet").click());
    expect(onChange).toHaveBeenCalledWith(["bio"]);
  });

  it("finds material by name", () => {
    act(() => root.render(<TutorSourcePicker sources={SOURCES} selectedIds={["bio"]} onChange={vi.fn()} />));
    act(() => button("+ Add more").click());
    const find = container.querySelector<HTMLInputElement>('input[placeholder^="Find"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(find, "forces");
      find.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(checkbox("Forces lecture")).not.toBeNull();
    expect(checkbox("Titrations worksheet")).toBeNull();
  });
});

describe("asking from the Tutor page", () => {
  it("sends what was typed, and offers the chat's own starting points", () => {
    const onAsk = vi.fn();
    act(() =>
      root.render(
        <TutorAskPanel sources={SOURCES} selectedIds={["bio"]} onSelectedChange={vi.fn()} onAsk={onAsk} />
      )
    );
    const box = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, "What do enzymes do?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Send to Jami").click());
    expect(onAsk).toHaveBeenCalledWith("What do enzymes do?");

    act(() => button("Quiz me").click());
    expect(onAsk).toHaveBeenLastCalledWith("Quiz me on the most important ideas in this source.");
  });

  it("asks across sources in the plural when several are chosen", () => {
    const onAsk = vi.fn();
    act(() =>
      root.render(
        <TutorAskPanel sources={SOURCES} selectedIds={["bio", "chem"]} onSelectedChange={vi.fn()} onAsk={onAsk} />
      )
    );
    act(() => button("Connect the ideas").click());
    expect(onAsk).toHaveBeenCalledWith(
      "How do the ideas in these sources fit together? Explain them as one picture."
    );
  });

  it("sends a student with no material to add some first", () => {
    act(() =>
      root.render(<TutorAskPanel sources={[]} selectedIds={[]} onSelectedChange={vi.fn()} onAsk={vi.fn()} />)
    );
    expect(container.textContent).toContain("Give Jami something to read first");
    expect(container.querySelector("textarea")).toBeNull();
    // What Jami does with material is said even before there is any.
    expect(container.textContent).toContain("Reads only what you hand it");
  });
});
