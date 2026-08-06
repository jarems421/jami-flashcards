// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SmoothingSlider from "@/components/workspace/NotebookSmoothingSlider";
import { NOTEBOOK_PEN_SMOOTHING_DEFAULT } from "@/lib/workspace/notebook-pen-feel";

let container: HTMLDivElement;
let root: Root;

function render(percent: number, onChange = vi.fn()) {
  act(() => {
    root.render(<SmoothingSlider percent={percent} onChange={onChange} />);
  });
  const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!slider) throw new Error("The smoothing control should render a slider.");
  return { onChange, slider };
}

beforeEach(() => {
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

describe("the pen smoothing control", () => {
  it("offers the whole range against a labelled current setting", () => {
    const { slider } = render(NOTEBOOK_PEN_SMOOTHING_DEFAULT);

    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");
    expect(slider.value).toBe(String(NOTEBOOK_PEN_SMOOTHING_DEFAULT));
    expect(slider.getAttribute("aria-label")).toBe("Pen smoothing");
    // A bare percentage says nothing about what it does to the line.
    expect(slider.getAttribute("aria-valuetext")).toContain("Balanced");
    expect(container.textContent).toContain("Smoothing");
    expect(container.textContent).toContain("Balanced");
  });

  it("names both ends so the direction of the control is clear", () => {
    expect(render(0).slider.getAttribute("aria-valuetext")).toContain(
      "Faithful"
    );
    expect(render(100).slider.getAttribute("aria-valuetext")).toContain(
      "Flowing"
    );
  });

  it("reports the chosen value", () => {
    const { onChange, slider } = render(50);

    // React tracks the last value it wrote and ignores an event whose value it
    // believes has not changed, so the native setter has to do the writing.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    act(() => {
      setValue?.call(slider, "80");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(80);
  });

  it("shows a stored setting outside the range at its nearest end", () => {
    expect(render(-20).slider.value).toBe("0");
    expect(render(400).slider.value).toBe("100");
  });

  it("says which way the control runs", () => {
    render(50);
    expect(container.textContent).toContain("Every turn kept");
    expect(container.textContent).toContain("Curves carried through");
  });

  it("fills the rail up to the thumb rather than to the edge", () => {
    // The thumb's centre stops half a thumb short of either end, so a fill
    // measured against the full width drifts away from it.
    const filled = () =>
      container.querySelector<HTMLElement>("[style*='clip-path']")?.style
        .clipPath ?? "";

    render(0);
    expect(filled()).toContain("* 0)");
    render(100);
    expect(filled()).toContain("* 1)");
    render(50);
    expect(filled()).toContain("9px * 2");
    expect(filled()).toContain("* 0.5)");
  });

  it("draws one rail the whole way across", () => {
    render(50);
    const rails = container.querySelectorAll("svg");
    // A base rail and the filled copy over it, both spanning the full box.
    expect(rails).toHaveLength(2);
    for (const rail of rails) {
      expect(rail.getAttribute("viewBox")).toBe("0 0 100 14");
      const path = rail.querySelector("path")?.getAttribute("d") ?? "";
      expect(path.startsWith("M0 ")).toBe(true);
      expect(path.trimEnd().endsWith("100 7")).toBe(true);
    }
  });
});
