import { describe, expect, it } from "vitest";
import {
  arrangeStarsToDrawing,
  describeStarShortage,
  readSkyDrawing,
  type SkyDrawing,
} from "@/lib/constellation/sky-drawing";
import { normalizeStar, type NormalizedStar } from "@/lib/constellation/stars";

function makeStars(count: number, sizes: number[] = []): NormalizedStar[] {
  return Array.from({ length: count }, (_, index) =>
    normalizeStar({
      id: `star-${String(index).padStart(2, "0")}`,
      goalId: `goal-${index}`,
      constellationId: "initial",
      // ln(targetCards + 1), the modern scale: bigger goals, bigger stars.
      size: sizes[index] ?? 2,
      glow: 0.8,
      createdAt: index,
      position: { x: 50, y: 50 },
    })
  );
}

/** A heart drawn the way a model draws one: a closed loop of many points. */
const heart: SkyDrawing = {
  strokes: [
    {
      closed: true,
      points: [
        [50, 30], [40, 18], [26, 16], [16, 26], [16, 40], [24, 54], [36, 66],
        [50, 82], [64, 66], [76, 54], [84, 40], [84, 26], [74, 16], [60, 18],
      ],
    },
  ],
  area: { x: 50, y: 50, size: 0.9 },
};

function distanceOnScreen(a: { x: number; y: number }, b: { x: number; y: number }, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

describe("reading a drawing", () => {
  it("accepts strokes as point arrays or objects, and keeps them on the canvas", () => {
    const drawing = readSkyDrawing({
      strokes: [[[0, 0], [120, -5]], { points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 10 }], closed: true }, "nonsense"],
      area: { x: 99, size: 60 },
    });
    expect(drawing?.strokes).toEqual([
      { points: [[0, 0], [100, 0]], closed: false },
      { points: [[10, 10], [20, 20], [30, 10]], closed: true },
    ]);
    expect(drawing?.area).toEqual({ x: 85, y: 50, size: 0.6 });
  });

  it("gives up on a reply with no strokes", () => {
    expect(readSkyDrawing({ strokes: [] })).toBeNull();
    expect(readSkyDrawing("a cat")).toBeNull();
  });
});

describe("fitting a drawing to the stars there are", () => {
  it("uses every star, once, whatever the drawing asked for", () => {
    for (const count of [2, 5, 14, 30]) {
      const stars = makeStars(count);
      const { positions } = arrangeStarsToDrawing({ stars, drawing: heart, aspectRatio: 1.6 });
      expect(Object.keys(positions).sort()).toEqual(stars.map((star) => star.id).sort());
    }
  });

  /*
   * Too few stars for the drawing: the loop keeps its shape with fewer points,
   * so a five-star heart is still one closed outline.
   */
  it("simplifies a picture to fit a small sky without breaking it apart", () => {
    const stars = makeStars(5);
    const { lines, figureStarCount } = arrangeStarsToDrawing({ stars, drawing: heart, aspectRatio: 1.6 });

    expect(figureStarCount).toBe(5);
    expect(lines).toHaveLength(5);
    const degree = new Map<string, number>();
    for (const line of lines) {
      degree.set(line.a, (degree.get(line.a) ?? 0) + 1);
      degree.set(line.b, (degree.get(line.b) ?? 0) + 1);
    }
    expect([...degree.values()].every((count) => count === 2)).toBe(true);
  });

  it("keeps the bottom tip of the heart, the point that makes it a heart", () => {
    const { positions } = arrangeStarsToDrawing({ stars: makeStars(6), drawing: heart, aspectRatio: 1 });
    const lowest = Math.max(...Object.values(positions).map((position) => position.y));
    const highest = Math.min(...Object.values(positions).map((position) => position.y));
    // The tip sits well below every other point, not rounded off.
    expect(lowest - highest).toBeGreaterThan(40);
  });

  it("scatters stars a picture does not need, clear of it and unjoined", () => {
    const stars = makeStars(30);
    const line: SkyDrawing = { strokes: [{ points: [[20, 50], [80, 50]], closed: false }], area: { x: 50, y: 50, size: 0.5 } };
    const { positions, lines, figureStarCount } = arrangeStarsToDrawing({ stars, drawing: line, aspectRatio: 1.6 });

    expect(figureStarCount).toBeLessThan(30);
    const joined = new Set(lines.flatMap((entry) => [entry.a, entry.b]));
    const loose = stars.filter((star) => !joined.has(star.id));
    expect(loose.length).toBe(30 - figureStarCount);
    for (const star of loose) {
      expect(Math.abs(positions[star.id].y - 50)).toBeGreaterThan(3);
    }
  });

  it("puts the brightest stars on the points that matter most", () => {
    // star-00 is the biggest by far; the lone dot is the most important point.
    const stars = makeStars(4, [6, 1, 1, 1]);
    const face: SkyDrawing = {
      strokes: [
        { points: [[20, 70], [50, 80], [80, 70]], closed: false },
        { points: [[50, 20]], closed: false },
      ],
      area: { x: 50, y: 50, size: 0.9 },
    };
    const { positions } = arrangeStarsToDrawing({ stars, drawing: face, aspectRatio: 1 });
    const topmost = Object.entries(positions).sort((a, b) => a[1].y - b[1].y)[0][0];
    expect(topmost).toBe("star-00");
  });

  it("keeps a circle round on a wide sky and inside the edges", () => {
    const circle: SkyDrawing = {
      strokes: [{ closed: true, points: Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2;
        return [50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40] as [number, number];
      }) }],
      area: { x: 50, y: 50, size: 0.9 },
    };
    const aspect = 2;
    const { positions } = arrangeStarsToDrawing({ stars: makeStars(12), drawing: circle, aspectRatio: aspect });
    const points = Object.values(positions);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const screenWidth = (Math.max(...xs) - Math.min(...xs)) * aspect;
    const screenHeight = Math.max(...ys) - Math.min(...ys);
    expect(screenWidth / screenHeight).toBeCloseTo(1, 1);
    expect(points.every((point) => point.x >= 6 && point.x <= 94 && point.y >= 6 && point.y <= 94)).toBe(true);
  });

  it("never stacks two stars on top of each other", () => {
    const dots: SkyDrawing = {
      strokes: Array.from({ length: 8 }, () => ({ points: [[50, 50]] as [number, number][], closed: false })),
      area: { x: 50, y: 50, size: 0.9 },
    };
    const { positions } = arrangeStarsToDrawing({ stars: makeStars(8), drawing: dots, aspectRatio: 1.6 });
    const points = Object.values(positions);
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        expect(distanceOnScreen(points[a], points[b], 1.6)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("is the same sky every time for the same request", () => {
    const first = arrangeStarsToDrawing({ stars: makeStars(9), drawing: heart, aspectRatio: 1.4 });
    const second = arrangeStarsToDrawing({ stars: makeStars(9), drawing: heart, aspectRatio: 1.4 });
    expect(second).toEqual(first);
  });
});

describe("fitting a real constellation to the stars there are", () => {
  const orion: SkyDrawing = { strokes: [], constellation: "orion", area: { x: 50, y: 50, size: 0.9 } };

  function components(lines: { a: string; b: string }[], ids: string[]) {
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
    for (const line of lines) parent.set(find(line.a), find(line.b));
    return new Set(ids.map(find)).size;
  }

  it("reads a named constellation without needing strokes", () => {
    expect(readSkyDrawing({ constellation: "Orion" })).toEqual(orion);
    expect(readSkyDrawing({ constellation: "draco" })).toBeNull();
  });

  it("adds no stars along its lines, and scatters the rest", () => {
    const { lines, figureStarCount } = arrangeStarsToDrawing({ stars: makeStars(16), drawing: orion, aspectRatio: 1.6 });
    expect(figureStarCount).toBe(8);
    expect(lines).toHaveLength(8);
  });

  it("loses its faintest stars first and stays in one piece", () => {
    const stars = makeStars(6, [6, 5, 4, 3, 2, 1]);
    const { lines, positions, figureStarCount } = arrangeStarsToDrawing({ stars, drawing: orion, aspectRatio: 1 });

    expect(figureStarCount).toBe(6);
    expect(components(lines, stars.map((star) => star.id))).toBe(1);
    // Rigel is the brightest star in Orion, so the brightest star earned takes
    // its place: bottom right, below and right of Betelgeuse's, which goes to the next.
    expect(positions["star-00"].x).toBeGreaterThan(positions["star-01"].x);
    expect(positions["star-00"].y).toBeGreaterThan(positions["star-01"].y);
  });
});

describe("saying when a picture needs more stars", () => {
  it("speaks up only when the sky is well short", () => {
    expect(describeStarShortage(4, 12)).toBe(
      "You have 4 stars, so this is a simpler version. It will look fuller with about 12."
    );
    expect(describeStarShortage(10, 12)).toBeNull();
    expect(describeStarShortage(4, null)).toBeNull();
  });
});
