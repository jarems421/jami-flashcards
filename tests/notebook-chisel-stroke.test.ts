// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { createNotebookChiselStrokeFactory } from "@/lib/workspace/notebook-chisel-stroke";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";

/**
 * The highlighter's whole character is its geometry, so these assert the
 * shape rather than that a stroke was produced at all. A round nib would pass
 * "a path came back"; only the outline distinguishes the two.
 */
let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

const NIB_ANGLE_DEGREES = 65;

function point(x: number, y: number, width = 20) {
  return {
    pos: jsDraw.Vec2.of(x, y),
    width,
    color: jsDraw.Color4.fromString("#ffd400"),
    time: 0,
  };
}

/** A viewport whose pixel is small enough not to filter the test's samples. */
const viewport = { getSizeOfPixelOnCanvas: () => 0.01 } as never;

function buildStroke(points: ReturnType<typeof point>[]) {
  const builder = createNotebookChiselStrokeFactory(jsDraw)(points[0], viewport);
  for (const next of points.slice(1)) builder.addPoint(next);
  return builder.build();
}

function outlineOf(points: ReturnType<typeof point>[]) {
  return buildStroke(points)
    .getParts()[0]
    .path.geometry.flatMap((part) =>
      "p1" in part ? [part.p1, part.p2] : [part.p1]
    );
}

describe("chisel highlighter geometry", () => {
  /**
   * How wide the stroke actually is, across its direction of travel. A
   * bounding box cannot be used here: for a diagonal stroke it measures the
   * travel, not the mark.
   */
  function perpendicularThickness(from: [number, number], to: [number, number]) {
    const outline = outlineOf([point(...from), point(...to)]);
    const axis = jsDraw.Vec2.of(to[0] - from[0], to[1] - from[1]).normalized();
    // The first and last corners are the same sample offset by +nib and -nib,
    // so the vector between them is the nib laid end to end.
    const across = outline[0].minus(outline[outline.length - 1]);
    return Math.abs(across.x * axis.y - across.y * axis.x);
  }

  it("offsets along a fixed nib angle rather than perpendicular to travel", () => {
    const radians = (NIB_ANGLE_DEGREES * Math.PI) / 180;
    const horizontal = perpendicularThickness([0, 0], [100, 0]);
    const alongNib = perpendicularThickness(
      [0, 0],
      [100 * Math.cos(radians), 100 * Math.sin(radians)]
    );

    // A round nib would make these identical. A chisel is broad across its
    // edge and vanishes to a line along it, which is the whole point.
    expect(horizontal).toBeCloseTo(20 * Math.sin(radians), 1);
    expect(alongNib).toBeCloseTo(0, 5);
  });

  it("keeps close to the full thickness on an ordinary horizontal sweep", () => {
    const outline = outlineOf([point(0, 0), point(120, 0)]);
    const ys = outline.map((corner) => corner.y);
    const spread = Math.max(...ys) - Math.min(...ys);

    // 20 wide at 65 degrees: 20 * sin(65) is about 18.1.
    expect(spread).toBeCloseTo(20 * Math.sin((NIB_ANGLE_DEGREES * Math.PI) / 180), 1);
  });

  it("ends on a slant, which is what reads as a highlighter", () => {
    const outline = outlineOf([point(0, 0), point(120, 0)]);
    // The two corners at the start of the stroke are offset by +nib and -nib,
    // so the leading edge runs at the nib angle rather than straight up.
    const leading = outline[0];
    const trailing = outline[outline.length - 1];
    const edgeAngle =
      (Math.atan2(leading.y - trailing.y, leading.x - trailing.x) * 180) /
      Math.PI;

    expect(Math.abs(edgeAngle) % 180).toBeCloseTo(NIB_ANGLE_DEGREES, 0);
  });

  it("draws a visible mark for a tap, where a flat edge alone would not", () => {
    const box = buildStroke([point(50, 50)]).getBBox();

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("discards samples too close together to change the shape", () => {
    const dense = createNotebookChiselStrokeFactory(jsDraw)(point(0, 0), {
      getSizeOfPixelOnCanvas: () => 4,
    } as never);
    for (let x = 0; x <= 20; x += 0.5) dense.addPoint(point(x, 0));

    // 41 samples across 20 units, filtered to roughly one every 2.6 units.
    const corners = dense.build().getParts()[0].path.geometry.length;
    expect(corners).toBeLessThan(30);
  });

  it("produces a filled path, so overlaps within one stroke do not darken", () => {
    const style = buildStroke([point(0, 0), point(60, 0)]).getParts()[0].style;

    expect(style.fill.a).toBeGreaterThan(0);
    expect(style.stroke).toBeUndefined();
  });
});
