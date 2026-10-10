// @vitest-environment jsdom

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  ComponentBuilder,
  RenderablePathSpec,
  Stroke,
  StrokeDataPoint,
} from "js-draw";
import {
  createNotebookSmoothPenStrokeFactory,
  readNotebookPenLiveTip,
} from "@/lib/workspace/notebook-smooth-pen";
import { createNotebookChiselStrokeFactory } from "@/lib/workspace/notebook-chisel-stroke";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";
import {
  getNotebookPenFeel,
  getNotebookPenFeelFromSettings,
  NOTEBOOK_PEN_SETTINGS_DEFAULT,
  NOTEBOOK_PEN_SMOOTHING_DEFAULT,
  type NotebookPenFeel,
} from "@/lib/workspace/notebook-pen-feel";

/**
 * The geometry of the pen and the highlighter, frozen.
 *
 * Every case below drives the js-draw builders through a fixed stroke and
 * records each path they draw: the wet preview at a few points mid-stroke and
 * the committed stroke at the end. The fixture holds those paths as plain
 * numbers. A stroke already saved never changes shape, and the pure geometry in
 * `lib/ink/geometry/` has to draw exactly what the code it was moved out of
 * did, command for command.
 *
 * To record the fixture afresh, which changes what every new stroke looks like
 * and so needs a reason: `REGENERATE_INK_GOLDEN=1`.
 */
const FIXTURE = resolve(__dirname, "fixtures/ink/geometry/golden.json");
const REGENERATE = process.env.REGENERATE_INK_GOLDEN === "1";
/** Recorded to 1e-9; compared a hair looser so another platform's libm cannot fail it. */
const TOLERANCE = 1e-6;

let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

type Sample = { x: number; y: number; width: number; time: number };

/** A small seeded generator, so "jitter" is the same on every machine. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function along(
  count: number,
  at: (t: number) => { x: number; y: number },
  options: { width?: number | ((t: number) => number); step?: number; jitter?: number; seed?: number } = {}
): Sample[] {
  const random = seeded(options.seed ?? 1);
  const widthAt = options.width ?? 5;
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    const where = at(t);
    const noise = options.jitter ?? 0;
    return {
      x: where.x + (random() - 0.5) * 2 * noise,
      y: where.y + (random() - 0.5) * 2 * noise,
      width: typeof widthAt === "function" ? widthAt(t) : widthAt,
      time: index * (options.step ?? 8),
    };
  });
}

const straight = (from: [number, number], to: [number, number]) => (t: number) => ({
  x: from[0] + (to[0] - from[0]) * t,
  y: from[1] + (to[1] - from[1]) * t,
});

const arc = (t: number) => ({
  x: 300 + Math.cos(t * Math.PI) * 150,
  y: 300 + Math.sin(t * Math.PI) * 150,
});

/** Joined-up writing: a rolling loop with a slow drift, like "ell". */
const loops = (t: number) => ({
  x: 40 + t * 220 + 16 * Math.sin(t * Math.PI * 6),
  y: 200 + 22 * Math.cos(t * Math.PI * 6) - 10 * Math.sin(t * Math.PI * 2),
});

const sCurve = (t: number) => ({
  x: 40 + t * 200,
  y: 160 + 60 * Math.sin(t * Math.PI * 2),
});

const veeShape = (t: number) =>
  t < 0.5
    ? { x: 20 + t * 2 * 96, y: 200 - t * 2 * 96 }
    : { x: 116 + (t - 0.5) * 2 * 96, y: 104 + (t - 0.5) * 2 * 96 };

/** Up the stem of an 'l' and straight back down it. */
const retrace = (t: number) => ({
  x: 50,
  y: t < 0.5 ? 200 - t * 2 * 120 : 80 + (t - 0.5) * 2 * 118,
});

const pressure = (t: number) => 1.5 + 6 * Math.sin(t * Math.PI);

type PenCase = {
  name: string;
  samples: Sample[];
  feel?: NotebookPenFeel;
  pixelSize?: number;
  /** Sample counts at which the wet stroke is drawn, besides the end. */
  previewAfter: number[];
  /** Hold still: snap straight, then aim the far end at each of these. */
  straighten?: { aim: Sample[] };
};

const DEFAULT_FEEL = getNotebookPenFeel(NOTEBOOK_PEN_SMOOTHING_DEFAULT);
const settingsFeel = (changes: Partial<typeof NOTEBOOK_PEN_SETTINGS_DEFAULT>) =>
  getNotebookPenFeelFromSettings({ ...NOTEBOOK_PEN_SETTINGS_DEFAULT, ...changes });

const nearlyStraight = along(40, straight([30, 60], [330, 74]), { jitter: 1, seed: 9 });

const PEN_CASES: PenCase[] = [
  {
    name: "thin constant width arc",
    samples: along(60, arc, { width: 2 }),
    previewAfter: [2, 10, 31],
  },
  {
    name: "thick constant width arc",
    samples: along(60, arc, { width: 14 }),
    previewAfter: [3, 20, 45],
  },
  {
    name: "pressure varying S curve",
    samples: along(70, sCurve, { width: pressure }),
    previewAfter: [2, 12, 40],
  },
  {
    name: "dot",
    samples: along(1, () => ({ x: 120, y: 90 }), { width: 6 }),
    previewAfter: [],
  },
  {
    name: "dot from samples inside the minimum step",
    samples: [
      { x: 80, y: 80, width: 6, time: 0 },
      { x: 80.2, y: 80.1, width: 6, time: 8 },
      { x: 80.1, y: 79.9, width: 6, time: 16 },
    ],
    previewAfter: [2],
  },
  {
    name: "sharp corner",
    samples: along(50, veeShape, { width: 4 }),
    previewAfter: [8, 25, 30],
  },
  {
    name: "sharp corner slowing into the point",
    samples: [
      ...along(14, straight([20, 200], [100, 120]), { width: 4, step: 6 }),
      ...along(6, straight([104, 124], [116, 136]), { width: 4, step: 30 }).map((s, i) => ({
        ...s,
        time: 84 + (i + 1) * 30,
      })),
      ...along(14, straight([122, 134], [200, 210]), { width: 4, step: 6 }).map((s, i) => ({
        ...s,
        time: 270 + (i + 1) * 6,
      })),
    ],
    previewAfter: [10, 20, 28],
  },
  {
    name: "retrace up and down an l",
    samples: along(40, retrace, { width: 3, step: 10 }),
    previewAfter: [6, 20, 21],
  },
  {
    name: "fast sparse points",
    samples: along(14, (t) => ({ x: 30 + t * 340, y: 180 + 70 * Math.sin(t * Math.PI * 1.5) }), {
      width: 4,
      step: 8,
    }),
    previewAfter: [3, 8],
  },
  {
    name: "slow dense points",
    samples: along(160, (t) => ({ x: 60 + t * 40, y: 100 + 14 * Math.sin(t * Math.PI * 3) }), {
      width: 3,
      step: 8,
      jitter: 0.1,
      seed: 3,
    }),
    previewAfter: [5, 80],
  },
  {
    name: "jittered handwriting",
    samples: along(120, loops, { width: pressure, jitter: 0.7, seed: 11 }),
    previewAfter: [4, 30, 75],
  },
  {
    name: "jittered handwriting at constant width",
    samples: along(120, loops, { width: 4, jitter: 0.7, seed: 12 }),
    previewAfter: [4, 30, 75],
  },
  {
    name: "straightened line, then aimed",
    samples: nearlyStraight,
    previewAfter: [10, 30],
    straighten: {
      aim: along(5, straight([330, 78], [200, 330]), { width: 5 }).map((s, i) => ({
        ...s,
        time: 400 + i * 8,
      })),
    },
  },
  {
    name: "straightened line aimed near a guide angle",
    samples: along(40, straight([30, 60], [330, 66]), { jitter: 1, seed: 8 }),
    previewAfter: [20],
    straighten: {
      aim: [
        { x: 325, y: 68, width: 5, time: 400 },
        { x: 320, y: 90, width: 5, time: 410 },
        { x: 100, y: 270, width: 5, time: 420 },
        { x: 30.4, y: 330, width: 5, time: 430 },
      ],
    },
  },
  {
    name: "straightening refused for a curve",
    samples: along(40, arc, { width: 4 }),
    previewAfter: [20],
    straighten: { aim: [] },
  },
  {
    name: "straightened line without snapping to guides",
    samples: nearlyStraight,
    feel: settingsFeel({ straightenOnHold: "lines" }),
    previewAfter: [],
    straighten: {
      aim: along(4, straight([330, 78], [30.5, 330]), { width: 5 }).map((s, i) => ({
        ...s,
        time: 400 + i * 8,
      })),
    },
  },
  {
    name: "no smoothing handwriting",
    samples: along(100, loops, { width: pressure, jitter: 0.7, seed: 21 }),
    feel: getNotebookPenFeel(0),
    previewAfter: [10, 60],
  },
  {
    name: "full smoothing handwriting",
    samples: along(100, loops, { width: pressure, jitter: 0.7, seed: 21 }),
    feel: getNotebookPenFeel(100),
    previewAfter: [10, 60],
  },
  {
    name: "corner sharpness at the faithful end",
    samples: along(60, loops, { width: 4, jitter: 0.5, seed: 33 }),
    feel: settingsFeel({ cornerSharpnessPercent: 100, smoothingPercent: 70 }),
    previewAfter: [30],
  },
  {
    name: "corner sharpness at the flowing end",
    samples: along(60, loops, { width: 4, jitter: 0.5, seed: 33 }),
    feel: settingsFeel({ cornerSharpnessPercent: 0, smoothingPercent: 70 }),
    previewAfter: [30],
  },
  {
    name: "pressure response off",
    samples: along(60, sCurve, { width: pressure }),
    feel: settingsFeel({ pressurePercent: 0 }),
    previewAfter: [30],
  },
  {
    name: "pressure response exaggerated",
    samples: along(60, sCurve, { width: pressure }),
    feel: settingsFeel({ pressurePercent: 100 }),
    previewAfter: [30],
  },
  {
    name: "zoomed in handwriting",
    samples: along(100, (t) => ({ x: 10 + t * 30, y: 20 + 4 * Math.sin(t * Math.PI * 4) }), {
      width: pressure,
      jitter: 0.04,
      seed: 41,
    }),
    pixelSize: 0.25,
    previewAfter: [10, 55],
  },
];

type ChiselCase = {
  name: string;
  samples: Sample[];
  pixelSize: number;
  /** Radians, asked once per accepted sample. */
  nibAngle?: (index: number) => number;
  previewAfter: number[];
};

const ANGLE_65 = (65 * Math.PI) / 180;

const CHISEL_CASES: ChiselCase[] = [
  {
    name: "horizontal highlight",
    samples: along(40, straight([30, 100], [330, 102]), { width: 20 }),
    pixelSize: 0.01,
    previewAfter: [3, 15],
  },
  {
    name: "default angle nib on a diagonal",
    samples: along(40, straight([30, 60], [260, 200]), { width: 24 }),
    pixelSize: 1,
    previewAfter: [10],
  },
  {
    name: "angled nib turning as the pen is held",
    samples: along(60, loops, { width: 22, jitter: 0.3, seed: 7 }),
    pixelSize: 0.01,
    nibAngle: (index) => ANGLE_65 + Math.sin(index / 6) * 0.6,
    previewAfter: [6, 30],
  },
  {
    name: "single point",
    samples: along(1, () => ({ x: 90, y: 90 }), { width: 20 }),
    pixelSize: 1,
    previewAfter: [],
  },
  {
    name: "tap that moves less than a step",
    samples: [
      { x: 90, y: 90, width: 20, time: 0 },
      { x: 90.5, y: 90.2, width: 20, time: 8 },
    ],
    pixelSize: 1,
    previewAfter: [],
  },
  {
    name: "long sweep over several lines",
    samples: along(
      200,
      (t) => ({
        x: 40 + (t * 5 - Math.floor(t * 5)) * 300,
        y: 60 + Math.floor(t * 5) * 14 + 4 * Math.sin(t * 90),
      }),
      { width: 18, jitter: 0.4, seed: 17 }
    ),
    pixelSize: 0.5,
    previewAfter: [20, 120],
  },
  {
    name: "nib turning to run along the stroke",
    samples: along(30, straight([30, 150], [230, 150]), { width: 20 }),
    pixelSize: 1,
    nibAngle: () => 0,
    previewAfter: [10],
  },
  {
    name: "union cannot be traced, so the footprints are kept",
    samples: Array.from({ length: 21 }, (_, index) => {
      // Found by searching for a stroke whose footprints the union gives up on.
      const random = seeded(15458 + 100000);
      const wobble = 0.4098196201957762;
      let point = { x: 0, y: 0 };
      for (let step = 0; step <= index; step += 1) {
        const t = step / 20;
        const turn = t * 0.9606215318199247 * 2 * Math.PI;
        point = {
          x: 200 + Math.cos(turn) * 60 * (1 - 0.3 * t) + (random() - 0.5) * wobble,
          y: 200 + Math.sin(turn) * 60 + (random() - 0.5) * wobble,
        };
      }
      return { ...point, width: 20, time: index * 8 };
    }),
    pixelSize: 0.5,
    nibAngle: (index) => {
      const hash = seeded(index * 7919 + 15458);
      return hash() < 0.3 ? hash() * Math.PI : ANGLE_65 + Math.sin(index / 5);
    },
    previewAfter: [10],
  },
  {
    name: "doubling back over itself",
    samples: [
      ...along(20, straight([30, 100], [200, 100]), { width: 20 }),
      ...along(20, straight([200, 108], [30, 108]), { width: 20 }).map((s, i) => ({
        ...s,
        time: 200 + i * 8,
      })),
    ],
    pixelSize: 0.5,
    previewAfter: [10, 25],
  },
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const rounded = (value: number) => Math.round(value * 1e9) / 1e9 + 0;

function dataPoint(sample: Sample): StrokeDataPoint {
  return {
    pos: jsDraw.Vec2.of(sample.x, sample.y),
    width: sample.width,
    color: jsDraw.Color4.fromString("#1b2a6b"),
    time: sample.time,
  };
}

function numbers(...values: number[]): Json {
  return values.map(rounded);
}

function serialiseStyle(style: RenderablePathSpec["style"]): Json {
  return {
    fill: style.fill.toHexString(),
    stroke: style.stroke
      ? { color: style.stroke.color.toHexString(), width: rounded(style.stroke.width) }
      : null,
  };
}

function serialiseSpec(spec: {
  startPoint: { x: number; y: number };
  commands: RenderablePathSpec["commands"];
  style: RenderablePathSpec["style"];
}): Json {
  const { PathCommandType } = jsDraw;
  return {
    start: numbers(spec.startPoint.x, spec.startPoint.y),
    commands: spec.commands.map((command): Json => {
      switch (command.kind) {
        case PathCommandType.MoveTo:
          return { kind: "M", at: numbers(command.point.x, command.point.y) };
        case PathCommandType.LineTo:
          return { kind: "L", at: numbers(command.point.x, command.point.y) };
        case PathCommandType.CubicBezierTo:
          return {
            kind: "C",
            at: numbers(
              command.controlPoint1.x,
              command.controlPoint1.y,
              command.controlPoint2.x,
              command.controlPoint2.y,
              command.endPoint.x,
              command.endPoint.y
            ),
          };
        case PathCommandType.QuadraticBezierTo:
          return {
            kind: "Q",
            at: numbers(
              command.controlPoint.x,
              command.controlPoint.y,
              command.endPoint.x,
              command.endPoint.y
            ),
          };
        default:
          throw new Error("Unexpected path command.");
      }
    }),
    style: serialiseStyle(spec.style),
  };
}

function serialiseStroke(stroke: Stroke): Json {
  return stroke.getParts().map((part) =>
    serialiseSpec({
      startPoint: part.path.startPoint,
      commands: part.path.parts,
      style: part.style,
    })
  );
}

function serialiseBox(builder: ComponentBuilder): Json {
  const box = builder.getBBox();
  return numbers(box.x, box.y, box.w, box.h);
}

function preview(builder: ComponentBuilder): Json {
  const drawn: Json[] = [];
  builder.preview({
    drawPath: (spec: RenderablePathSpec) => {
      drawn.push(serialiseSpec(spec));
    },
  } as never);
  return drawn;
}

function liveTip(builder: ComponentBuilder): Json {
  const tip = readNotebookPenLiveTip({ builder });
  return tip
    ? { at: numbers(tip.point.x, tip.point.y, tip.width), color: tip.color.toHexString() }
    : null;
}

function builtStroke(builder: ComponentBuilder): Json {
  const built = builder.build();
  if (!(built instanceof jsDraw.Stroke)) throw new Error("Expected a Stroke.");
  return serialiseStroke(built);
}

async function recordPen(entry: PenCase): Promise<Json> {
  const viewport = { getSizeOfPixelOnCanvas: () => entry.pixelSize ?? 1 } as never;
  const builder = createNotebookSmoothPenStrokeFactory(jsDraw, entry.feel ?? DEFAULT_FEEL)(
    dataPoint(entry.samples[0]),
    viewport
  );
  const previews: Json[] = [];
  entry.samples.slice(1).forEach((sample, index) => {
    builder.addPoint(dataPoint(sample));
    const count = index + 2;
    if (entry.previewAfter.includes(count)) {
      previews.push({ after: count, drawn: preview(builder), tip: liveTip(builder), box: serialiseBox(builder) });
    }
  });
  const record: { [key: string]: Json } = {
    previews,
    final: { drawn: preview(builder), tip: liveTip(builder), box: serialiseBox(builder) },
    built: builtStroke(builder),
  };

  if (entry.straighten) {
    const snapped = await builder.autocorrectShape?.();
    const aimed: Json[] = [];
    for (const sample of entry.straighten.aim) {
      builder.addPoint(dataPoint(sample));
      aimed.push({ drawn: preview(builder), tip: liveTip(builder), box: serialiseBox(builder) });
    }
    record.straighten = {
      snapped: snapped ? serialiseStroke(snapped as Stroke) : null,
      aimed,
      built: builtStroke(builder),
      again: (await builder.autocorrectShape?.()) ? "snapped again" : null,
    };
  }
  return record;
}

function recordChisel(entry: ChiselCase): Json {
  const viewport = { getSizeOfPixelOnCanvas: () => entry.pixelSize } as never;
  let accepted = 0;
  const nibAngle = entry.nibAngle
    ? () => entry.nibAngle!(accepted++)
    : undefined;
  const builder = createNotebookChiselStrokeFactory(jsDraw, nibAngle)(
    dataPoint(entry.samples[0]),
    viewport
  );
  const previews: Json[] = [];
  entry.samples.slice(1).forEach((sample, index) => {
    builder.addPoint(dataPoint(sample));
    const count = index + 2;
    if (entry.previewAfter.includes(count)) {
      previews.push({ after: count, drawn: preview(builder), box: serialiseBox(builder) });
    }
  });
  return {
    previews,
    final: { drawn: preview(builder), box: serialiseBox(builder) },
    built: builtStroke(builder),
  };
}

async function recordAll() {
  const pens: { [key: string]: Json } = {};
  for (const entry of PEN_CASES) pens[entry.name] = await recordPen(entry);
  const chisels: { [key: string]: Json } = {};
  for (const entry of CHISEL_CASES) chisels[entry.name] = recordChisel(entry);
  return { pens, chisels };
}

function expectSame(actual: Json, expected: Json, where: string) {
  if (typeof actual === "number" && typeof expected === "number") {
    if (Math.abs(actual - expected) > TOLERANCE) {
      throw new Error(`${where}: ${actual} is not ${expected}`);
    }
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      throw new Error(`${where}: ${actual.length} entries, expected ${expected.length}`);
    }
    actual.forEach((value, index) => expectSame(value, expected[index], `${where}[${index}]`));
    return;
  }
  if (
    actual !== null && expected !== null &&
    typeof actual === "object" && typeof expected === "object" &&
    !Array.isArray(actual) && !Array.isArray(expected)
  ) {
    const keys = Object.keys(expected);
    expect(Object.keys(actual), where).toEqual(keys);
    for (const key of keys) expectSame(actual[key], expected[key], `${where}.${key}`);
    return;
  }
  if (actual !== expected) {
    throw new Error(`${where}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`);
  }
}

/** One case to a line, so a changed stroke is a readable diff. */
function stringify(recorded: { pens: { [key: string]: Json }; chisels: { [key: string]: Json } }) {
  const lines = (group: { [key: string]: Json }) =>
    Object.entries(group)
      .map(([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`)
      .join(",\n");
  return `{\n  "pens": {\n${lines(recorded.pens)}\n  },\n  "chisels": {\n${lines(recorded.chisels)}\n  }\n}\n`;
}

describe("the pen and highlighter geometry", () => {
  it("draws every recorded stroke exactly as it was recorded", async () => {
    const recorded = await recordAll();
    if (REGENERATE) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, stringify(recorded));
      return;
    }
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
      pens: { [key: string]: Json };
      chisels: { [key: string]: Json };
    };
    expect(Object.keys(recorded.pens)).toEqual(Object.keys(expected.pens));
    expect(Object.keys(recorded.chisels)).toEqual(Object.keys(expected.chisels));
    for (const [name, value] of Object.entries(recorded.pens)) {
      expectSame(value, expected.pens[name], `pen: ${name}`);
    }
    for (const [name, value] of Object.entries(recorded.chisels)) {
      expectSame(value, expected.chisels[name], `chisel: ${name}`);
    }
  }, 60_000);

  it("covers every branch the pen and highlighter draw", async () => {
    const recorded = await recordAll();
    const text = JSON.stringify(recorded.pens);
    // A stroked centre line, a filled outline and a filled dot all appear.
    expect(text).toContain('"stroke":{"color"');
    expect(text).toContain('"stroke":null');
    // Cubic pieces, and the straight line a snapped stroke becomes.
    expect(text).toContain('"kind":"C"');
    expect(text).toContain('"kind":"L"');
    const snapped = recorded.pens["straightened line, then aimed"] as { straighten: { snapped: Json } };
    expect(snapped.straighten.snapped).not.toBeNull();
    const refused = recorded.pens["straightening refused for a curve"] as { straighten: { snapped: Json } };
    expect(refused.straighten.snapped).toBeNull();
    // The highlighter commits one loop, and keeps its footprints where the union fails.
    const loop = JSON.stringify((recorded.chisels["horizontal highlight"] as { built: Json }).built);
    expect(loop).not.toContain('"kind":"M"');
    const kept = JSON.stringify(
      (recorded.chisels["union cannot be traced, so the footprints are kept"] as { built: Json }).built
    );
    expect(kept).toContain('"kind":"M"');
  }, 60_000);
});
