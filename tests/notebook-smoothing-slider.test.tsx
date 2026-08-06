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

  it("runs one rail the whole way across, with the travelled part filled", () => {
    render(50);
    const rails = container.querySelectorAll<HTMLElement>("[aria-hidden='true']");
    expect(rails).toHaveLength(2);

    // The base rail spans the control end to end.
    expect(rails[0].className).toContain("inset-x-0");
    // The filled part starts at the same left edge and stops at the thumb.
    expect(rails[1].className).toContain("left-0");
    expect(rails[1].style.width).toContain("9px");
  });

  it("fills up to the thumb rather than to the edge", () => {
    const fill = () =>
      container.querySelectorAll<HTMLElement>("[aria-hidden='true']")[1].style
        .width;

    render(50);
    const midway = fill();
    // Half of the thumb's *travel*, not half of the control: the inset its
    // centre keeps at either end is part of the sum, so the fill lands under
    // the thumb rather than drifting up to a thumb's width away from it.
    expect(midway).toContain("9px");
    expect(midway).toContain("0.5");

    render(0);
    expect(fill()).not.toBe(midway);
    render(100);
    expect(fill()).not.toBe(midway);
  });

  it("stays compact", () => {
    render(50);
    // One line of explanation under the control, no end captions either side.
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.textContent).not.toContain("Every turn kept");
  });
});
