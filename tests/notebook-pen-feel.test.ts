// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Stroke, StrokeDataPoint } from "js-draw";
import { createNotebookSmoothPenStrokeFactory } from "@/lib/workspace/notebook-smooth-pen";
import {
  clampNotebookPenSmoothing,
  getNotebookPenFeel,
  getNotebookPenSmoothingLabel,
  NOTEBOOK_PEN_SMOOTHING_DEFAULT,
  NOTEBOOK_PEN_SMOOTHING_STORAGE_KEY,
  readNotebookPenSmoothingPreference,
  saveNotebookPenSmoothingPreference,
} from "@/lib/workspace/notebook-pen-feel";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";

let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

afterEach(() => {
  window.localStorage.clear();
});

const PEN_WIDTH = 3;
const viewport = {
  getSizeOfPixelOnCanvas: () => 1,
  visibleRect: { x: 0, y: 0, w: 1000, h: 1000 },
} as never;

function point(x: number, y: number): StrokeDataPoint {
  return {
    pos: jsDraw.Vec2.of(x, y),
    width: PEN_WIDTH,
    color: jsDraw.Color4.fromString("#101010"),
    time: 0,
  };
}

function build(points: StrokeDataPoint[], smoothing: number) {
  const builder = createNotebookSmoothPenStrokeFactory(
    jsDraw,
    getNotebookPenFeel(smoothing)
  )(points[0], viewport);
  for (const next of points.slice(1)) builder.addPoint(next);
  return builder.build() as Stroke;
}

/**
 * The turn taken at each join between drawn curves.
 *
 * A join that turns is a corner, and two corners in a row are joined by a
 * straight chord -- so counting them is counting how much of the writing is
 * being drawn as short straight runs rather than as a line.
 */
function joinTurns(stroke: Stroke) {
  const turns: number[] = [];
  let previousEnd: ReturnType<typeof jsDraw.Vec2.of> | null = null;
  let previousControl: ReturnType<typeof jsDraw.Vec2.of> | null = null;

  for (const part of stroke.getParts()[0].path.parts) {
    if (part.kind !== jsDraw.PathCommandType.CubicBezierTo) continue;
    if (previousEnd && previousControl) {
      const incoming = previousEnd.minus(previousControl).normalized();
      const outgoing = part.controlPoint1.minus(previousEnd).normalized();
      const dot = Math.max(-1, Math.min(1, incoming.dot(outgoing)));
      turns.push((Math.acos(dot) * 180) / Math.PI);
    }
    previousEnd = part.endPoint;
    previousControl = part.controlPoint2;
  }
  return turns;
}

/** Joined-up writing: a run of loops at handwriting scale, with hand wobble. */
function cursive(xHeight: number) {
  const samplesPerLoop = Math.round(xHeight * 0.6);
  let seed = 7;
  const wobble = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return ((seed / 2147483648) * 2 - 1) * 0.4;
  };
  return Array.from({ length: samplesPerLoop * 4 + 1 }, (_, step) => {
    const t = (step / samplesPerLoop) * Math.PI * 2;
    return point(
      20 + (step / samplesPerLoop) * xHeight * 1.1 + wobble(),
      200 - Math.sin(t) * (xHeight / 2) + wobble()
    );
  });
}

const kinkCount = (stroke: Stroke) =>
  joinTurns(stroke).filter((turn) => turn > 1).length;

/** How far the drawn line ends up from the points the pen actually visited. */
function meanDeviation(stroke: Stroke, points: StrokeDataPoint[]) {
  const path = stroke.getParts()[0].path;
  const drawn: Array<{ x: number; y: number }> = [];
  let from = path.startPoint;
  for (const part of path.parts) {
    if (part.kind !== jsDraw.PathCommandType.CubicBezierTo) {
      if ("point" in part) from = part.point;
      continue;
    }
    for (let step = 0; step <= 16; step += 1) {
      const t = step / 16;
      const u = 1 - t;
      drawn.push({
        x:
          u ** 3 * from.x +
          3 * u * u * t * part.controlPoint1.x +
          3 * u * t * t * part.controlPoint2.x +
          t ** 3 * part.endPoint.x,
        y:
          u ** 3 * from.y +
          3 * u * u * t * part.controlPoint1.y +
          3 * u * t * t * part.controlPoint2.y +
          t ** 3 * part.endPoint.y,
      });
    }
    from = part.endPoint;
  }

  let total = 0;
  for (const sample of points) {
    let nearest = Infinity;
    for (const on of drawn) {
      nearest = Math.min(
        nearest,
        Math.hypot(on.x - sample.pos.x, on.y - sample.pos.y)
      );
    }
    total += nearest;
  }
  return total / points.length;
}

describe("pen smoothing", () => {
  it("draws handwriting with fewer corners the further it is turned up", () => {
    // The complaint this setting answers: at handwriting scale a plain curve
    // turns far enough between kept points to be taken for a deliberate point,
    // and a run of those is drawn as a run of chords.
    const points = cursive(34);
    const faithful = kinkCount(build(points, 0));
    const standard = kinkCount(build(points, NOTEBOOK_PEN_SMOOTHING_DEFAULT));
    const flowing = kinkCount(build(points, 100));

    expect(standard).toBeLessThan(faithful);
    expect(flowing).toBeLessThan(standard);
    // The default has to be a real improvement on the faithful end, not a nudge.
    expect(standard).toBeLessThan(faithful / 2);
  });

  it("buys fewer corners without the line fighting the hand", () => {
    /*
     * Easing is the only part of this that moves the line off the points the
     * pen visited, and it does so in proportion. A heavy easing ceiling made
     * turning smoothing up feel restrictive rather than smooth -- the pen
     * resisting at every turn -- so the corner threshold, which costs no
     * deviation at all, is what carries the range.
     */
    const points = cursive(34);
    const faithful = meanDeviation(build(points, 0), points);
    const flowing = meanDeviation(build(points, 100), points);

    expect(flowing).toBeLessThan(0.4);
    expect(flowing - faithful).toBeLessThan(0.3);
  });

  it("keeps a deliberate corner at every setting", () => {
    // A 'v' drawn at handwriting scale. Rounding this off is the failure the
    // corner threshold exists to prevent, so no setting may do it.
    const points = [
      ...Array.from({ length: 14 }, (_, s) => point(20 + s * 2, 200 - s * 2)),
      ...Array.from({ length: 14 }, (_, s) => point(46 + s * 2, 174 + s * 2)),
    ];

    for (const smoothing of [0, 25, 50, NOTEBOOK_PEN_SMOOTHING_DEFAULT, 100]) {
      expect(Math.max(...joinTurns(build(points, smoothing)))).toBeGreaterThan(
        60
      );
    }
  });

  it("still ends exactly under the pen however hard it smooths", () => {
    // Easing never moves the newest point: that is the difference between
    // guidance and the ink being dragged behind the nib.
    const points = cursive(40);
    const drawnTo = points[points.length - 1].pos;

    for (const smoothing of [0, 50, 100]) {
      const parts = build(points, smoothing).getParts()[0].path.parts;
      const last = parts[parts.length - 1];
      expect("endPoint" in last).toBe(true);
      if (!("endPoint" in last)) continue;
      expect(last.endPoint.x).toBeCloseTo(drawnTo.x, 6);
      expect(last.endPoint.y).toBeCloseTo(drawnTo.y, 6);
    }
  });

  it("moves both controls together and only within their bounds", () => {
    const faithful = getNotebookPenFeel(0);
    const flowing = getNotebookPenFeel(100);
    const middle = getNotebookPenFeel(50);

    expect(faithful.easeTowardsNeighbours).toBe(0);
    expect(flowing.cornerDegrees).toBeGreaterThan(faithful.cornerDegrees);
    expect(flowing.easeTowardsNeighbours).toBeGreaterThan(
      faithful.easeTowardsNeighbours
    );
    expect(middle.cornerDegrees).toBeGreaterThan(faithful.cornerDegrees);
    expect(middle.cornerDegrees).toBeLessThan(flowing.cornerDegrees);
    // A corner threshold at or past a right angle would stop a 'v' being one.
    expect(flowing.cornerDegrees).toBeLessThan(90);
    // Easing stays at the light touch it has always had, whatever the setting:
    // it is the one control here that pulls the line off the hand.
    expect(flowing.easeTowardsNeighbours).toBeLessThanOrEqual(0.35);
  });

  it("clamps anything the slider or storage could hand it", () => {
    expect(clampNotebookPenSmoothing(-40)).toBe(0);
    expect(clampNotebookPenSmoothing(140)).toBe(100);
    expect(clampNotebookPenSmoothing(61.6)).toBe(62);
    expect(clampNotebookPenSmoothing(Number.NaN)).toBe(
      NOTEBOOK_PEN_SMOOTHING_DEFAULT
    );
  });

  it("names the setting rather than leaving a bare number", () => {
    expect(getNotebookPenSmoothingLabel(0).name).toBe("None");
    expect(getNotebookPenSmoothingLabel(100).name).toBe("Strong");
    for (const percent of [0, 30, 60, 90]) {
      expect(getNotebookPenSmoothingLabel(percent).description.length)
        .toBeGreaterThan(0);
    }
  });

  it("remembers the setting and survives a corrupted one", () => {
    expect(readNotebookPenSmoothingPreference()).toBe(
      NOTEBOOK_PEN_SMOOTHING_DEFAULT
    );

    saveNotebookPenSmoothingPreference(18);
    expect(readNotebookPenSmoothingPreference()).toBe(18);

    // Zero is a real choice, not a missing one.
    saveNotebookPenSmoothingPreference(0);
    expect(readNotebookPenSmoothingPreference()).toBe(0);

    window.localStorage.setItem(NOTEBOOK_PEN_SMOOTHING_STORAGE_KEY, "smooth");
    expect(readNotebookPenSmoothingPreference()).toBe(
      NOTEBOOK_PEN_SMOOTHING_DEFAULT
    );
  });
});
