// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotebookGraphEditorDialog from "@/components/workspace/NotebookGraphEditorDialog";
import SettingSwitch from "@/components/ui/SettingSwitch";

declare global {
  // React only treats a test as an act() environment when this is set.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

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

function openEditor() {
  act(() => {
    root.render(
      <NotebookGraphEditorDialog
        open
        graph={null}
        onCancel={() => undefined}
        onSave={() => undefined}
      />
    );
  });
}

/** The dialog renders into a portal, so look at the whole document. */
function field(label: string) {
  const found = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`
  );
  if (!found) throw new Error(`No "${label}" field rendered.`);
  return found;
}

const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
      element,
      value
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("the graph editor's More options", () => {
  it("says which end of which range each box is, without a placeholder", () => {
    /*
     * The four limits were a 2x2 grid whose meaning lived only in placeholder
     * text -- which disappears the moment a number is typed, leaving four
     * anonymous boxes. Paired from-and-to rows carry the axis in the row and
     * the end in the field's own name.
     */
    openEditor();

    for (const label of ["x from", "x to", "y from", "y to"]) {
      const box = field(label);
      // A real starting value, not a placeholder that vanishes when used.
      expect(box.getAttribute("placeholder"), label).toBe(null);
      expect(box.value.length, label).toBeGreaterThan(0);
    }
  });

  it("keeps every setting the long form had", () => {
    openEditor();

    for (const label of [
      "Graph title",
      "x-axis label",
      "y-axis label",
      "Points, one x, y pair to a line",
    ]) {
      expect(field(label), label).toBeTruthy();
    }

    const switches = [...document.querySelectorAll('[role="switch"]')].map(
      (element) => element.getAttribute("aria-label")
    );
    expect(switches).toContain("Grid lines");
    expect(switches).toContain("Join with a line");
  });

  it("says from the outside whether anything inside is set", () => {
    // A folded section that says nothing costs exactly what folding it saved:
    // the only way to find out is to open it.
    openEditor();
    expect(document.body.textContent).toContain("More options");
    expect(document.body.textContent).toContain("Nothing set");

    type(field("Graph title"), "Braking distance");
    expect(document.body.textContent).toContain("Title");
    expect(document.body.textContent).not.toContain("Nothing set");

    type(field("Points, one x, y pair to a line"), "1, 2\n3, 5");
    expect(document.body.textContent).toContain("2 points");
  });

  it("counts a single point as one", () => {
    openEditor();
    type(field("Points, one x, y pair to a line"), "1, 2");
    expect(document.body.textContent).toContain("1 point");
    expect(document.body.textContent).not.toContain("1 points");
  });
});

describe("SettingSwitch", () => {
  it("is the whole row, not a sixteen-pixel box", () => {
    // The checkboxes these replace gave a finger a 16px target on a tablet.
    const onChange = vi.fn();
    act(() => {
      root.render(
        <SettingSwitch
          label="Grid lines"
          description="Faint squares behind the curve"
          checked={false}
          onChange={onChange}
        />
      );
    });

    const control = container.querySelector('[role="switch"]');
    if (!control) throw new Error("No switch rendered.");
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(control.className).toContain("min-h-11");
    // Named by the label alone, so the description stays a description.
    expect(control.getAttribute("aria-label")).toBe("Grid lines");

    act(() => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
