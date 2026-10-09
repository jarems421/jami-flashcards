import type {
  InkColor,
  InkDocument,
  InkItem,
  InkOutlineItem,
  InkPathCommand,
  InkShapeItem,
} from "@/lib/ink/model";

/** A small seeded PRNG (mulberry32) so property tests are repeatable. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BLACK: InkColor = { r: 0, g: 0, b: 0, a: 1 };

export function outline(id: string, path: InkPathCommand[], layer: "pen" | "highlighter" = "pen"): InkOutlineItem {
  return {
    kind: "outline",
    id,
    layer,
    path,
    paint: { fill: BLACK, stroke: null, opacity: 1 },
  };
}

export function lineShape(id: string, x1: number, y1: number, x2: number, y2: number): InkShapeItem {
  return {
    kind: "shape",
    id,
    layer: "pen",
    color: BLACK,
    width: 4,
    shape: { type: "line", from: { x: x1, y: y1 }, to: { x: x2, y: y2 } },
  };
}

export function docOf(...items: InkItem[]): InkDocument {
  return { version: 3, items };
}

function pick<T>(random: () => number, choices: readonly T[]): T {
  return choices[Math.floor(random() * choices.length)];
}

function coordinate(random: () => number): number {
  // Mostly on-page, sometimes far outside it, never aligned to the 1/16 grid.
  const span = random() < 0.1 ? 5000 : 1000;
  return (random() - 0.4) * span;
}

function randomColor(random: () => number): InkColor {
  return {
    r: Math.floor(random() * 256),
    g: Math.floor(random() * 256),
    b: Math.floor(random() * 256),
    a: random() < 0.5 ? 1 : random(),
  };
}

function randomCommands(random: () => number): InkPathCommand[] {
  const commands: InkPathCommand[] = [{ op: "M", x: coordinate(random), y: coordinate(random) }];
  const count = Math.floor(random() * 12);
  for (let i = 0; i < count; i += 1) {
    const kind = Math.floor(random() * 5);
    if (kind === 0) commands.push({ op: "L", x: coordinate(random), y: coordinate(random) });
    else if (kind === 1) {
      commands.push({
        op: "Q",
        x1: coordinate(random),
        y1: coordinate(random),
        x: coordinate(random),
        y: coordinate(random),
      });
    } else if (kind === 2) {
      commands.push({
        op: "C",
        x1: coordinate(random),
        y1: coordinate(random),
        x2: coordinate(random),
        y2: coordinate(random),
        x: coordinate(random),
        y: coordinate(random),
      });
    } else if (kind === 3) commands.push({ op: "Z" });
    else commands.push({ op: "M", x: coordinate(random), y: coordinate(random) });
  }
  return commands;
}

function randomItem(random: () => number, id: string): InkItem {
  if (random() < 0.5) {
    const hasFill = random() < 0.6;
    const hasStroke = !hasFill || random() < 0.5;
    return {
      kind: "outline",
      id,
      layer: pick(random, ["highlighter", "pen"] as const),
      path: randomCommands(random),
      paint: {
        fill: hasFill ? randomColor(random) : null,
        stroke: hasStroke
          ? {
              color: randomColor(random),
              width: random() * 40,
              cap: pick(random, ["round", "butt", "square"] as const),
              join: pick(random, ["round", "miter", "bevel"] as const),
            }
          : null,
        opacity: random(),
      },
    };
  }
  const base = { kind: "shape" as const, id, layer: "pen" as const, color: randomColor(random), width: random() * 30 };
  const type = pick(random, ["line", "arrow", "polygon", "ellipse"] as const);
  if (type === "line" || type === "arrow") {
    return {
      ...base,
      shape: {
        type,
        from: { x: coordinate(random), y: coordinate(random) },
        to: { x: coordinate(random), y: coordinate(random) },
      },
    };
  }
  if (type === "polygon") {
    const corners = Array.from({ length: 3 + Math.floor(random() * 3) }, () => ({
      x: coordinate(random),
      y: coordinate(random),
    }));
    return { ...base, shape: { type, corners } };
  }
  return {
    ...base,
    shape: {
      type,
      cx: coordinate(random),
      cy: coordinate(random),
      rx: random() * 300,
      ry: random() * 300,
      rotation: (random() - 0.5) * 12,
    },
  };
}

export function randomInkDocument(random: () => number): InkDocument {
  const count = Math.floor(random() * 8);
  return { version: 3, items: Array.from({ length: count }, (_, i) => randomItem(random, `item${i}-${Math.floor(random() * 1e6)}`)) };
}
