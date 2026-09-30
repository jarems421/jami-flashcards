import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_PEN_ERASER_BUTTONS,
  NOTEBOOK_STRAIGHTEN_HOLD,
  getNotebookContactTool,
  relaxNotebookStraightenHold,
} from "@/lib/workspace/notebook-ink-runtime";

/**
 * The hold that snaps a line straight has to be one a hand can satisfy.
 *
 * js-draw wants an average speed under 8.5 screen pixels a second, which is
 * under a seventh of a pixel per frame and below what a hand resting a stylus
 * on glass does. Every time the tremor crosses it the timer restarts, so the
 * snap arrives late or never -- and it reads as "hold it for longer" rather
 * than as a threshold nobody can meet.
 */
describe("relaxNotebookStraightenHold", () => {
  it("gives the detector a threshold a resting hand can meet", () => {
    expect(NOTEBOOK_STRAIGHTEN_HOLD.maxSpeed).toBeGreaterThan(8.5);

    /*
     * And does not buy that by making the snap easy to trip while writing.
     *
     * With the timer running for a second, the drift allowance is what decides
     * how slowly somebody can be writing and still snap by accident: staying
     * inside it for the whole second is only possible below `maxRadius` pixels
     * a second. That band was briefly doubled, and a snap mid-word does not
     * merely tidy the stroke -- everything drawn after it becomes a line
     * swinging around after the pen.
     */
    const accidentalBelow =
      NOTEBOOK_STRAIGHTEN_HOLD.maxRadius / NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds;
    expect(accidentalBelow).toBeLessThanOrEqual(11);
    // Longer than js-draw's half second, on purpose: half a second of
    // stillness happens in the middle of ordinary writing, and it is the pause
    // that is being asked about rather than the shape of the stroke.
    expect(NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds).toBeGreaterThanOrEqual(0.75);
    expect(NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds).toBeLessThanOrEqual(2);
  });

  it("replaces the config once the stroke has begun", () => {
    const detector = { config: { maxSpeed: 8.5, maxRadius: 11, minTimeSeconds: 0.5 } };
    const pen = {
      stationaryDetector: null as typeof detector | null,
      onPointerDown() {
        this.stationaryDetector = detector;
        return true;
      },
    };

    expect(relaxNotebookStraightenHold(pen)).toBe(true);
    expect(pen.onPointerDown()).toBe(true);
    expect(pen.stationaryDetector!.config.maxSpeed).toBe(
      NOTEBOOK_STRAIGHTEN_HOLD.maxSpeed
    );
    expect(pen.stationaryDetector!.config.minTimeSeconds).toBe(
      NOTEBOOK_STRAIGHTEN_HOLD.minTimeSeconds
    );
  });

  it("says so rather than throwing when js-draw has moved on", () => {
    // A patch on somebody else's internals should fail loudly at the seam, not
    // silently leave the hold unreachable.
    expect(relaxNotebookStraightenHold({})).toBe(false);
  });

  it("leaves a stroke that never starts one alone", () => {
    const pen = { stationaryDetector: null, onPointerDown: () => undefined };
    expect(relaxNotebookStraightenHold(pen)).toBe(true);
    expect(() => pen.onPointerDown()).not.toThrow();
  });
});

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
