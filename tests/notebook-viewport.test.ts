import { describe, expect, it } from "vitest";
import { getNotebookInkViewportScale } from "@/lib/workspace/notebook-viewport";

describe("notebook ink viewport", () => {
  it("maps notebook coordinates to the full visible page without centred margins", () => {
    expect(
      getNotebookInkViewportScale({
        displayWidth: 450,
        displayHeight: 713,
        pageWidth: 900,
        pageHeight: 1240,
      })
    ).toEqual({
      x: 0.5,
      y: 713 / 1240,
    });
  });

  it("supports the portrait page stretch without adding an origin offset", () => {
    const scale = getNotebookInkViewportScale({
      displayWidth: 900,
      displayHeight: 1426,
      pageWidth: 900,
      pageHeight: 1240,
    });

    expect(scale.x).toBe(1);
    expect(scale.y).toBeCloseTo(1.15, 2);
  });
});
