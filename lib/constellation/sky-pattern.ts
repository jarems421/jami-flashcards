import {
  normalizeConstellationLines,
  type ConstellationLine,
} from "@/lib/constellation/constellations";
import { readSkyDrawing, type SkyDrawing } from "@/lib/constellation/sky-drawing";
import { findStarMap, STAR_MAPS } from "@/lib/constellation/star-maps";
import type { StarPosition } from "@/lib/constellation/stars";

/**
 * Asking Jami to turn a sky into a picture.
 *
 * Jami draws and the app arranges. The reply is a drawing -- strokes on a
 * square canvas, or the name of a real constellation -- and never a star id,
 * so there is nothing in it that could add, remove or misplace a student's
 * stars. `arrangeStarsToDrawing` fits whatever stars the sky holds to it.
 */

export const SKY_PATTERN_REQUEST_MAX_LENGTH = 300;
const HISTORY_LIMIT = 6;
const REPLY_MAX_LENGTH = 280;
const EDGE_MARGIN = 6;

export type SkyPatternTurn = { role: "student" | "jami"; text: string };

/** What Jami said, before it meets the stars. */
export type SkyPatternReply = {
  reply: string;
  /** Null when Jami answered without drawing anything. */
  drawing: SkyDrawing | null;
  /** How many stars the picture needs to look its best, when Jami said. */
  idealStars: number | null;
};

/** What the page receives: the picture already fitted to its stars. */
export type SkyPattern = {
  reply: string;
  positions: Record<string, StarPosition>;
  /** Every line the sky should have, or null to keep the lines it has. */
  lines: ConstellationLine[] | null;
  /** Sent back with a follow-up, so "bigger" has something to be bigger than. */
  drawing: SkyDrawing | null;
};

const STAR_MAP_LIST = STAR_MAPS.map((map) => `${map.key} (${map.name})`).join(", ");

export const SKY_PATTERN_SYSTEM_PROMPT = `You are Jami, drawing pictures for a student's constellation. You draw with strokes on a square canvas, and the app turns your drawing into the student's own stars.

Canvas: x from 0 (left) to 100 (right), y from 0 (top) to 100 (bottom). Use most of the canvas; the app scales and centres the picture and keeps its proportions.

How to draw well:
- Draw like an illustrator making an icon: a bold, instantly recognisable silhouette with the features that make the subject itself (a cat's pointed ears and whiskers, a rocket's fins and flame, a butterfly's four wings and antennae).
- Every point becomes one of the student's stars, so their star count is your budget of points. Design the picture for that many and never use more: with a few, the simplest version that is still unmistakable; with plenty, the charming details.
- Spend points where the shape needs them: corners and tips first, then enough along curves to make them read as curves. A straight line needs only its two ends.
- Use separate strokes for separate parts. Where one stroke meets another, reuse the exact same point so they join.
- A single point on its own is a stroke with one point: an eye, a nose, a lone star.
- Closed shapes set "closed": true rather than repeating their first point.
- Keep it elegant: 1 to 10 strokes. Symmetric subjects must be symmetric.
- For an open request ("surprise me", "something cute"), choose one delightful subject and draw it beautifully.
- "idealStars" is how many stars the picture needs to look its best.

Real constellations: if the student asks for one of these, do not draw it. Return "constellation" with its key and no strokes, and the app uses the real star positions: ${STAR_MAP_LIST}.

"area" places the picture: its centre as percentages of the sky (x and y from 15 to 85) and its size from 0.3 to 1. Use {"x": 50, "y": 50, "size": 0.9} unless asked otherwise.

For a follow-up ("bigger", "move it left", "give it a tail"), start from the previous drawing and change only what was asked. Return the whole drawing again.

If the request is not about a picture in the sky, return no strokes and no constellation, and say briefly what you can do.

"reply" is one short, warm sentence in your own words about what you drew. Talk about the picture, never about star counts or how the app works.

Return only JSON. For example, "a little house":
{"reply": "Here's a cosy little house.", "idealStars": 8, "area": {"x": 50, "y": 50, "size": 0.9}, "strokes": [{"points": [[18, 48], [50, 16], [82, 48]], "closed": false}, {"points": [[26, 41], [26, 86], [74, 86], [74, 41]], "closed": false}, {"points": [[42, 86], [42, 64], [58, 64], [58, 86]], "closed": false}]}
And "Orion":
{"reply": "Here's Orion, the hunter, just as he stands in the winter sky.", "constellation": "orion", "area": {"x": 50, "y": 50, "size": 0.9}}`;

export function isValidConstellationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

export function readSkyPatternHistory(value: unknown): SkyPatternTurn[] {
  if (!Array.isArray(value)) return [];
  const entries: unknown[] = value;
  const turns: SkyPatternTurn[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { role, text } = entry as { role?: unknown; text?: unknown };
    if ((role !== "student" && role !== "jami") || typeof text !== "string" || !text.trim()) continue;
    turns.push({ role, text: text.trim().slice(0, SKY_PATTERN_REQUEST_MAX_LENGTH) });
  }
  return turns.slice(-HISTORY_LIMIT);
}

/** Width over height, bounded, and a computer-shaped sky when it is unknown. */
export function clampSkyAspectRatio(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(3, Math.max(0.4, value))
    : 1.6;
}

/** A drawing as compact JSON, whole numbers only: it goes back into a prompt. */
function describeDrawing(drawing: SkyDrawing) {
  return JSON.stringify({
    area: drawing.area,
    ...(drawing.constellation ? { constellation: drawing.constellation } : {}),
    strokes: drawing.strokes.map((stroke) => ({
      points: stroke.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
      closed: stroke.closed,
    })),
  });
}

export function buildSkyPatternPrompt(input: {
  starCount: number;
  request: string;
  history: SkyPatternTurn[];
  previousDrawing: SkyDrawing | null;
  aspectRatio: number;
}) {
  const conversation = input.history.map(
    (turn) => `${turn.role === "student" ? "Student" : "Jami"}: ${turn.text}`
  );
  return [
    // The count is a budget, not trivia: a picture designed for six points
    // reads far better than a detailed one cut down to six afterwards.
    `The student has ${input.starCount} stars, so use no more than ${input.starCount} points in total. A point shared by two strokes counts once.`,
    `Their sky is ${input.aspectRatio.toFixed(2)} times as wide as it is tall.`,
    ...(input.previousDrawing ? [`Previous drawing: ${describeDrawing(input.previousDrawing)}`] : []),
    ...(conversation.length ? [`Conversation so far:\n${conversation.join("\n")}`] : []),
    `Request: ${input.request}`,
  ].join("\n\n");
}

function extractJsonObject(raw: string) {
  const unfenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : null;
}

/** Reads Jami's reply, or null when there is nothing usable in it at all. */
export function parseSkyPatternReply(raw: string): SkyPatternReply | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const fields = parsed as { reply?: unknown; idealStars?: unknown };
  const drawing = readSkyDrawing(parsed);
  const starMap = drawing?.constellation ? findStarMap(drawing.constellation) : null;
  const reply = typeof fields.reply === "string" ? fields.reply.trim().slice(0, REPLY_MAX_LENGTH) : "";
  if (!reply && !drawing) return null;

  const idealStars = starMap
    ? starMap.starCount
    : typeof fields.idealStars === "number" && Number.isFinite(fields.idealStars)
      ? Math.round(Math.min(120, Math.max(1, fields.idealStars)))
      : null;

  return { reply: reply || "Here is your sky.", drawing, idealStars };
}

function clampCoordinate(value: number) {
  return Math.round(Math.min(100 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value)) * 10) / 10;
}

/** The route's answer as the page receives it, checked rather than trusted. */
export function readSkyPatternResponse(value: unknown): SkyPattern | null {
  if (typeof value !== "object" || value === null) return null;
  const { reply, positions, lines, drawing } = value as {
    reply?: unknown;
    positions?: unknown;
    lines?: unknown;
    drawing?: unknown;
  };
  if (typeof reply !== "string") return null;

  const readPositions: Record<string, StarPosition> = {};
  if (typeof positions === "object" && positions !== null) {
    for (const [starId, position] of Object.entries(positions)) {
      if (typeof position !== "object" || position === null) continue;
      const { x, y } = position as { x?: unknown; y?: unknown };
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      readPositions[starId] = { x: clampCoordinate(x), y: clampCoordinate(y) };
    }
  }

  return {
    reply: reply.slice(0, REPLY_MAX_LENGTH * 2),
    positions: readPositions,
    lines: Array.isArray(lines) ? normalizeConstellationLines(lines) : null,
    drawing: readSkyDrawing(drawing),
  };
}
