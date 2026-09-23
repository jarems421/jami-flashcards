import { describe, expect, it } from "vitest";
import {
  easeOutCubic,
  GUIDE_EDGE,
  GUIDE_GAP,
  guideThread,
  mixBox,
  placeGuideNote,
  type GuideBox,
} from "@/lib/onboarding/guide-placement";

/**
 * Where a walkthrough note sits beside what it points at.
 *
 * The old note assumed it was 200px tall, so it floated off short targets and
 * sat on top of them when it ran long; on a phone it was pinned above the tab
 * bar whatever it pointed at. Every case below is one of those.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844, reservedBottom: 96 };
const NOTE = { width: 340, height: 150 };

const overlaps = (a: GuideBox, b: GuideBox) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

function noteBox(placement: { x: number; y: number }, size = NOTE): GuideBox {
  return { left: placement.x, top: placement.y, ...size };
}

function onScreen(box: GuideBox, viewport: { width: number; height: number; reservedBottom?: number }) {
  return (
    box.left >= GUIDE_EDGE &&
    box.top >= GUIDE_EDGE &&
    box.left + box.width <= viewport.width - GUIDE_EDGE &&
    box.top + box.height <= viewport.height - (viewport.reservedBottom ?? 0) - GUIDE_EDGE
  );
}

describe("placing a note", () => {
  it("sits below a control near the top, centred on it", () => {
    const target = { left: 600, top: 120, width: 200, height: 44 };
    const placement = placeGuideNote({ target, note: NOTE, viewport: DESKTOP });
    expect(placement.side).toBe("below");
    expect(placement.y).toBe(target.top + target.height + GUIDE_GAP);
    expect(placement.x + NOTE.width / 2).toBe(target.left + target.width / 2);
  });

  it("goes above a control near the bottom rather than off the screen", () => {
    const target = { left: 600, top: 820, width: 200, height: 44 };
    const placement = placeGuideNote({ target, note: NOTE, viewport: DESKTOP });
    expect(placement.side).toBe("above");
    expect(overlaps(noteBox(placement), target)).toBe(false);
    expect(onScreen(noteBox(placement), DESKTOP)).toBe(true);
  });

  it("uses its real height, so a long note still clears its control", () => {
    const target = { left: 600, top: 520, width: 200, height: 44 };
    const tall = { width: 340, height: 330 };
    const placement = placeGuideNote({ target, note: tall, viewport: DESKTOP });
    expect(overlaps(noteBox(placement, tall), target)).toBe(false);
    expect(onScreen(noteBox(placement, tall), DESKTOP)).toBe(true);
  });

  it("sits beside the sidebar, not over the entries next to the one it means", () => {
    const sidebar = { left: 16, top: 16, width: 256, height: 860 };
    const entry = { left: 28, top: 330, width: 230, height: 48 };
    const placement = placeGuideNote({ target: entry, beside: sidebar, note: NOTE, viewport: DESKTOP });
    expect(placement.side).toBe("right");
    expect(placement.x).toBe(sidebar.left + sidebar.width + GUIDE_GAP);
    expect(overlaps(noteBox(placement), sidebar)).toBe(false);
  });

  it("keeps clear of a phone's tab bar, and never covers a tab it points at", () => {
    const tab = { left: 150, top: 770, width: 80, height: 56 };
    const note = { width: 366, height: 170 };
    const placement = placeGuideNote({ target: tab, note, viewport: PHONE });
    expect(placement.side).toBe("above");
    expect(overlaps(noteBox(placement, note), tab)).toBe(false);
    expect(placement.y + note.height).toBeLessThanOrEqual(PHONE.height - PHONE.reservedBottom - GUIDE_EDGE);
  });

  it("floats at the foot of the screen when there is nothing to point at, or no room", () => {
    const floating = placeGuideNote({ target: null, note: NOTE, viewport: DESKTOP });
    expect(floating.side).toBe("floating");
    expect(onScreen(noteBox(floating), DESKTOP)).toBe(true);

    // A control that fills the screen leaves no side to sit on.
    const huge = placeGuideNote({
      target: { left: 0, top: 0, width: 1440, height: 900 },
      note: NOTE,
      viewport: DESKTOP,
    });
    expect(huge.side).toBe("floating");
  });
});

describe("the thread between a note and its control", () => {
  it("runs from the note's nearest edge to the control's, crossing neither", () => {
    const note = { left: 100, top: 300, width: 340, height: 150 };
    const target = { left: 200, top: 120, width: 120, height: 40 };
    const line = guideThread(note, target);
    expect(line).not.toBeNull();
    expect(line!.from.y).toBe(note.top);
    expect(line!.to.y).toBe(target.top + target.height);
  });

  it("is not drawn when the two touch", () => {
    const note = { left: 100, top: 160, width: 340, height: 150 };
    const target = { left: 200, top: 120, width: 120, height: 40 };
    expect(guideThread(note, target)).toBeNull();
  });
});

describe("travelling from one control to the next", () => {
  it("arrives gently and exactly", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    const from = { left: 0, top: 0, width: 10, height: 10 };
    const to = { left: 100, top: 50, width: 30, height: 20 };
    expect(mixBox(from, to, 1)).toEqual(to);
    expect(mixBox(from, to, 0.5)).toEqual({ left: 50, top: 25, width: 20, height: 15 });
  });
});
