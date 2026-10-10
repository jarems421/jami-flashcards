import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_PEN_ERASER_BUTTONS,
  getNotebookContactTool,
} from "@/lib/workspace/notebook-ink-contact";

describe("the tool a contact works with", () => {
  it("is the selected tool for an ordinary contact", () => {
    for (const activeTool of ["pen", "highlighter", "eraser", "text"] as const) {
      expect(
        getNotebookContactTool({ activeTool, buttons: 1, pointerType: "pen" })
      ).toBe(activeTool);
    }
  });

  it("is the eraser when a pen touches down with its eraser end", () => {
    // What Windows reports for a Surface Pen or Wacom stylus turned over.
    expect(
      getNotebookContactTool({
        activeTool: "pen",
        buttons: NOTEBOOK_PEN_ERASER_BUTTONS,
        pointerType: "pen",
      })
    ).toBe("eraser");
    // Held with a barrel button down as well, it is still the eraser.
    expect(
      getNotebookContactTool({
        activeTool: "highlighter",
        buttons: NOTEBOOK_PEN_ERASER_BUTTONS | 2,
        pointerType: "pen",
      })
    ).toBe("eraser");
  });

  it("leaves a mouse's extra buttons alone", () => {
    // Only a pen has an eraser end; the bit means nothing from anything else.
    expect(
      getNotebookContactTool({
        activeTool: "pen",
        buttons: NOTEBOOK_PEN_ERASER_BUTTONS,
        pointerType: "mouse",
      })
    ).toBe("pen");
  });
});
