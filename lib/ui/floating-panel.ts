/**
 * Geometry for a panel that floats over a working surface: where it may sit,
 * how small or large it may be, and how a drag or a resize moves it.
 *
 * Pure so the boundaries can be tested without a browser. The panel is never
 * allowed to leave the viewport or shrink below something usable, but it may
 * grow to fill the whole window when a student wants to read at length.
 */

export type FloatingRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloatingViewport = {
  width: number;
  height: number;
};

export type FloatingLimits = {
  minWidth: number;
  minHeight: number;
  /** Space kept clear between the panel and every edge of the viewport. */
  margin: number;
};

/** Which edges a resize handle moves; a corner moves two. */
export type FloatingResizeEdges = {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function largestSize(viewport: FloatingViewport, limits: FloatingLimits) {
  return {
    width: Math.max(0, viewport.width - limits.margin * 2),
    height: Math.max(0, viewport.height - limits.margin * 2),
  };
}

/**
 * The same panel, pulled back inside the viewport.
 *
 * Size first, so a panel saved on a larger screen fits this one; then
 * position, so what fits is fully on screen. On a viewport too small for the
 * minimum the viewport wins: a panel that fits beats one that is usable size
 * but half off the glass.
 */
export function clampFloatingRect(
  rect: FloatingRect,
  viewport: FloatingViewport,
  limits: FloatingLimits
): FloatingRect {
  const largest = largestSize(viewport, limits);
  const width = Math.min(Math.max(rect.width, limits.minWidth), largest.width);
  const height = Math.min(Math.max(rect.height, limits.minHeight), largest.height);
  return {
    width,
    height,
    x: clampNumber(rect.x, limits.margin, viewport.width - limits.margin - width),
    y: clampNumber(rect.y, limits.margin, viewport.height - limits.margin - height),
  };
}

/** The panel moved by a pointer delta, stopping at the viewport's edges. */
export function moveFloatingRect(
  start: FloatingRect,
  dx: number,
  dy: number,
  viewport: FloatingViewport,
  limits: FloatingLimits
): FloatingRect {
  return clampFloatingRect(
    { ...start, x: start.x + dx, y: start.y + dy },
    viewport,
    limits
  );
}

/**
 * The panel resized by dragging some of its edges.
 *
 * The edges not being dragged stay exactly where they were: pulling the left
 * edge grows the panel leftwards without its right edge creeping, and when an
 * edge hits the minimum size or the viewport it stops there rather than
 * pushing the whole panel along.
 */
export function resizeFloatingRect(
  start: FloatingRect,
  edges: FloatingResizeEdges,
  dx: number,
  dy: number,
  viewport: FloatingViewport,
  limits: FloatingLimits
): FloatingRect {
  const startRight = start.x + start.width;
  const startBottom = start.y + start.height;
  const minX = limits.margin;
  const minY = limits.margin;
  const maxRight = viewport.width - limits.margin;
  const maxBottom = viewport.height - limits.margin;

  let left = start.x;
  let right = startRight;
  let top = start.y;
  let bottom = startBottom;

  if (edges.left) {
    left = clampNumber(start.x + dx, minX, startRight - limits.minWidth);
  } else if (edges.right) {
    right = clampNumber(startRight + dx, start.x + limits.minWidth, maxRight);
  }
  if (edges.top) {
    top = clampNumber(start.y + dy, minY, startBottom - limits.minHeight);
  } else if (edges.bottom) {
    bottom = clampNumber(startBottom + dy, start.y + limits.minHeight, maxBottom);
  }

  return clampFloatingRect(
    { x: left, y: top, width: right - left, height: bottom - top },
    viewport,
    limits
  );
}

/** The whole viewport, less the margin: the panel at full size. */
export function maximisedFloatingRect(
  viewport: FloatingViewport,
  limits: FloatingLimits
): FloatingRect {
  const largest = largestSize(viewport, limits);
  return { x: limits.margin, y: limits.margin, ...largest };
}

/**
 * A full-size panel dragged by its header, back at its own size.
 *
 * Like dragging a maximised window: it returns to the size it had, positioned
 * so the point being held stays under the pointer rather than the panel
 * jumping away from the hand that picked it up.
 */
export function restoreFloatingRectUnderPointer(
  restored: FloatingRect,
  full: FloatingRect,
  pointer: { x: number; y: number },
  viewport: FloatingViewport,
  limits: FloatingLimits
): FloatingRect {
  const across = full.width > 0 ? (pointer.x - full.x) / full.width : 0.5;
  return clampFloatingRect(
    { ...restored, x: pointer.x - restored.width * across, y: full.y },
    viewport,
    limits
  );
}

/**
 * A panel of the preferred size, tucked into the bottom-right corner.
 *
 * Bottom-right because that is where the page's margin is emptiest on a
 * landscape tablet, and furthest from the notebook's toolbar.
 */
export function cornerFloatingRect(
  size: { width: number; height: number },
  viewport: FloatingViewport,
  limits: FloatingLimits
): FloatingRect {
  const fitted = clampFloatingRect(
    { x: 0, y: 0, width: size.width, height: size.height },
    viewport,
    limits
  );
  return clampFloatingRect(
    {
      ...fitted,
      x: viewport.width - limits.margin - fitted.width,
      y: viewport.height - limits.margin - fitted.height,
    },
    viewport,
    limits
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A rectangle read back from storage, or null when it is not one.
 *
 * Storage is written by this app but can be cleared, hand-edited or left over
 * from an older shape, so nothing is trusted until every field checks out.
 */
export function parseStoredFloatingRect(value: unknown): FloatingRect | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { x, y, width, height } = record;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { x, y, width, height };
}
