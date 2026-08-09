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

/**
 * Joined-up writing: a run of loops at handwriting scale, with hand wobble.
 *
 * `spread` is how far along the line each loop travels, as a multiple of the
 * x-height, and it decides how tight the turn at the top of a loop is. Real
 * writing spreads about twice its x-height per loop; packed tighter than that
 * the peaks come out at a two-pixel radius, which is not a curve any hand makes
 * -- it is a cusp, and it is correctly drawn as one.
 */
function cursive(xHeight: number, spread = 2.2) {
  const samplesPerLoop = Math.round(xHeight * 0.6);
  let seed = 7;
  const wobble = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return ((seed / 2147483648) * 2 - 1) * 0.4;
  };
  return Array.from({ length: samplesPerLoop * 4 + 1 }, (_, step) => {
    const t = (step / samplesPerLoop) * Math.PI * 2;
    return point(
      20 + (step / samplesPerLoop) * xHeight * spread + wobble(),
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
  it("draws handwriting as curves, not as a run of chords", () => {
    /*
     * The complaint this answers, twice over.
     *
     * A corner used to be decided on the angle between one kept point and the
     * next, and points are kept by curvature -- so the tighter the curve, the
     * further it turned between them, and past a point every sample on it was
     * called a corner. A corner takes its control arms from the strokes either
     * side, so two in a row put both arms on the chord and the piece between
     * them was drawn as a literal straight line. Writing came out as a chain of
     * short flat runs, which is what "too sharp on the turns" was.
     *
     * Smaller writing was worse, which is the wrong way round. So this is not a
     * comparison between settings -- there is nothing left to trade off. A
     * curve is drawn as a curve, at every size, from the default upwards.
     */
    for (const xHeight of [18, 26, 34]) {
      const points = cursive(xHeight);
      const where = `x-height ${xHeight}`;
      expect(kinkCount(build(points, NOTEBOOK_PEN_SMOOTHING_DEFAULT)), where).toBe(0);
      expect(kinkCount(build(points, 100)), where).toBe(0);
    }
  });

  it("leaves a round letter round", () => {
    // An 'o' is the shape that suffered most: a small one is a tight curve all
    // the way round, so every point on it turned enough to be taken for a
    // deliberate one and it came back a polygon.
    for (const radius of [6, 10, 17]) {
      const points = Array.from({ length: Math.round(radius * 6) }, (_, step) => {
        const t = (step / Math.round(radius * 6)) * Math.PI * 2;
        return point(200 + Math.cos(t) * radius, 200 + Math.sin(t) * radius);
      });
      const turns = joinTurns(build(points, NOTEBOOK_PEN_SMOOTHING_DEFAULT));
      expect(Math.max(0, ...turns), `radius ${radius}`).toBeLessThan(1);
    }
  });

  it("still lets the setting decide the turns it is actually about", () => {
    /*
     * With curves no longer mistaken for corners, the control does the one job
     * left: how sharp a deliberate turn has to be before it is drawn as a
     * point. A turn this size is a judgement call -- some hands mean it, some
     * are just writing quickly -- which is why it is a setting.
     */
    const half = (60 / 2) * (Math.PI / 180);
    const bend = [
      ...Array.from({ length: 40 }, (_, k) =>
        point(100 - Math.cos(half) * (40 - k), 150 - Math.sin(half) * (40 - k))
      ),
      point(100, 150),
      ...Array.from({ length: 40 }, (_, k) =>
        point(100 + Math.cos(half) * (k + 1), 150 - Math.sin(half) * (k + 1))
      ),
    ];

    expect(Math.max(0, ...joinTurns(build(bend, 0)))).toBeGreaterThan(50);
    expect(
      Math.max(0, ...joinTurns(build(bend, NOTEBOOK_PEN_SMOOTHING_DEFAULT)))
    ).toBeGreaterThan(50);
    expect(Math.max(0, ...joinTurns(build(bend, 100)))).toBeLessThan(1);
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

  it("keeps every turn at the faithful end, which is what None means", async () => {
    /*
     * A turn only counts as a corner if it also stands out from the turns
     * either side of it -- which is what stops a tightly drawn curve being read
     * as a run of corners, and is exactly the wrong thing to do at zero.
     * Applied there it quietly rounded off turns somebody had asked to keep,
     * and the setting that promises "every turn you make is drawn as a point"
     * stopped keeping them.
     */
    expect(getNotebookPenFeel(0).cornerDominance).toBe(1);
    expect(getNotebookPenFeel(100).cornerDominance).toBeGreaterThan(1);

    // A turn well past the threshold, sitting among others just like it: the
    // shape a tight curve makes, and the case the dominance rule exists for.
    // Tight enough that the line turns well past the faithful threshold
    // between one kept point and the next, which is the whole situation the
    // dominance rule was added for.
    const points = Array.from({ length: 60 }, (_, step) => {
      const turn = (step / 59) * Math.PI;
      return point(120 + Math.cos(turn) * 12, 220 + Math.sin(turn) * 12);
    });

    const faithful = Math.max(...joinTurns(build(points, 0)), 0);
    const flowing = Math.max(...joinTurns(build(points, 100)), 0);

    // None keeps them; Strong carries them through. That difference is the
    // entire point of the slider.
    expect(faithful).toBeGreaterThan(5);
    expect(flowing).toBeLessThan(1);
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
