/**
 * Where a walkthrough note sits beside the control it is about.
 *
 * Measured, never assumed. The note used to be placed from a guessed height of
 * 200px, so a two-line note floated off its target and a five-line one sat on
 * top of it; on a phone it was pinned above the tab bar whatever it pointed at.
 * This takes the note's real size, tries each side of the target in a fixed
 * order, and keeps the first placement that fits on screen without covering
 * the target. Pure, so every case can be checked without a browser.
 */

export type GuideBox = { left: number; top: number; width: number; height: number };

export type GuideSide = "below" | "above" | "right" | "left" | "floating";

export type GuidePlacement = {
  /** Top-left of the note. */
  x: number;
  y: number;
  side: GuideSide;
};

export type GuideViewport = {
  width: number;
  height: number;
  /** Space the page keeps for itself at the bottom: a phone's tab bar and safe area. */
  reservedBottom?: number;
};

/** Breathing room from every edge of the screen. */
export const GUIDE_EDGE = 12;
/** Distance between a note and what it points at, which the thread crosses. */
export const GUIDE_GAP = 22;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

function overlaps(a: GuideBox, b: GuideBox) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * The placement for a note of `note` size about `target`.
 *
 * `beside` is a wider region to sit next to rather than inside -- the whole
 * sidebar when the target is one entry in it -- so a note about a sidebar
 * entry lands on the page beside the sidebar instead of over its neighbours.
 * Sides are tried in reading order for the case: beside a region, right then
 * left; otherwise below then above, where a note reads most naturally.
 */
export function placeGuideNote(input: {
  target: GuideBox | null;
  beside?: GuideBox | null;
  note: { width: number; height: number };
  viewport: GuideViewport;
}): GuidePlacement {
  const { note, viewport } = input;
  const bottomLimit = viewport.height - (viewport.reservedBottom ?? 0) - GUIDE_EDGE;
  const rightLimit = viewport.width - GUIDE_EDGE;
  const floating: GuidePlacement = {
    x: clamp((viewport.width - note.width) / 2, GUIDE_EDGE, rightLimit - note.width),
    y: clamp(bottomLimit - note.height, GUIDE_EDGE, bottomLimit - note.height),
    side: "floating",
  };
  const target = input.target;
  if (!target) return floating;

  const anchor = input.beside ?? target;
  const centreX = target.left + target.width / 2;
  const centreY = target.top + target.height / 2;
  const horizontal = (x: number) => clamp(x, GUIDE_EDGE, rightLimit - note.width);
  const vertical = (y: number) => clamp(y, GUIDE_EDGE, bottomLimit - note.height);

  const candidates: Record<Exclude<GuideSide, "floating">, GuidePlacement> = {
    below: { x: horizontal(centreX - note.width / 2), y: anchor.top + anchor.height + GUIDE_GAP, side: "below" },
    // Never lower than the reserved strip allows, for a target that sits in it -- a phone's tab bar.
    above: {
      x: horizontal(centreX - note.width / 2),
      y: Math.min(anchor.top - GUIDE_GAP - note.height, bottomLimit - note.height),
      side: "above",
    },
    right: { x: anchor.left + anchor.width + GUIDE_GAP, y: vertical(centreY - note.height / 2), side: "right" },
    left: { x: anchor.left - GUIDE_GAP - note.width, y: vertical(centreY - note.height / 2), side: "left" },
  };
  const order: Exclude<GuideSide, "floating">[] = input.beside
    ? ["right", "left", "below", "above"]
    : ["below", "above", "right", "left"];

  for (const side of order) {
    const placement = candidates[side];
    const box = { left: placement.x, top: placement.y, width: note.width, height: note.height };
    const onScreen =
      box.left >= GUIDE_EDGE - 0.5 &&
      box.top >= GUIDE_EDGE - 0.5 &&
      box.left + box.width <= rightLimit + 0.5 &&
      box.top + box.height <= bottomLimit + 0.5;
    if (onScreen && !overlaps(box, target)) return placement;
  }
  return floating;
}

/**
 * The thread from a note to its target: from the note's edge nearest the
 * target to the target's edge nearest the note, so it never crosses either.
 * Nothing when the two are nearly touching, because a line between them would
 * be a speck.
 */
export function guideThread(note: GuideBox, target: GuideBox, pad = 0) {
  const apart = Math.max(
    target.left - pad - (note.left + note.width),
    note.left - (target.left + target.width + pad),
    target.top - pad - (note.top + note.height),
    note.top - (target.top + target.height + pad)
  );
  if (apart < 8) return null;
  const expanded = {
    left: target.left - pad,
    top: target.top - pad,
    width: target.width + pad * 2,
    height: target.height + pad * 2,
  };
  const noteCentre = { x: note.left + note.width / 2, y: note.top + note.height / 2 };
  const targetCentre = { x: expanded.left + expanded.width / 2, y: expanded.top + expanded.height / 2 };
  const from = {
    x: clamp(targetCentre.x, note.left, note.left + note.width),
    y: clamp(targetCentre.y, note.top, note.top + note.height),
  };
  const to = {
    x: clamp(noteCentre.x, expanded.left, expanded.left + expanded.width),
    y: clamp(noteCentre.y, expanded.top, expanded.top + expanded.height),
  };
  return { from, to, length: Math.hypot(to.x - from.x, to.y - from.y) };
}

/** Ease-out for gliding from one target to the next: fast away, gentle arrival. */
export function easeOutCubic(t: number) {
  const clamped = clamp(t, 0, 1);
  return 1 - (1 - clamped) ** 3;
}

export function mixBox(from: GuideBox, to: GuideBox, t: number): GuideBox {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    left: mix(from.left, to.left),
    top: mix(from.top, to.top),
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}
