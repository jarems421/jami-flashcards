export const NOTEBOOK_TOOLBAR_DOCK_STORAGE_KEY = "jami:notebook-toolbar-dock";
export const NOTEBOOK_TOOLBAR_DRAG_THRESHOLD = 4;
export const NOTEBOOK_TOOLBAR_DOCK_HYSTERESIS = 24;
export const NOTEBOOK_TOOLBAR_VELOCITY_WINDOW_MS = 100;

export const NOTEBOOK_TOOLBAR_DOCKS = [
  "top",
  "right",
  "bottom",
  "left",
] as const;

export type NotebookToolbarDock = (typeof NOTEBOOK_TOOLBAR_DOCKS)[number];
export type NotebookToolbarPointerSample = {
  x: number;
  y: number;
  timeStamp: number;
};

export function isNotebookToolbarDock(
  value: unknown
): value is NotebookToolbarDock {
  return (
    typeof value === "string" &&
    NOTEBOOK_TOOLBAR_DOCKS.includes(value as NotebookToolbarDock)
  );
}

export function readNotebookToolbarDockPreference(): NotebookToolbarDock {
  if (typeof window === "undefined") return "bottom";

  try {
    const storedValue = window.localStorage.getItem(
      NOTEBOOK_TOOLBAR_DOCK_STORAGE_KEY
    );
    return isNotebookToolbarDock(storedValue) ? storedValue : "bottom";
  } catch {
    return "bottom";
  }
}

export function saveNotebookToolbarDockPreference(
  dock: NotebookToolbarDock
) {
  try {
    window.localStorage.setItem(NOTEBOOK_TOOLBAR_DOCK_STORAGE_KEY, dock);
  } catch {
    // This is a non-critical, device-local layout preference.
  }
}

export function isNotebookToolbarSideDock(dock: NotebookToolbarDock) {
  return dock === "left" || dock === "right";
}

export function hasNotebookToolbarDragStarted(input: {
  deltaX: number;
  deltaY: number;
  threshold?: number;
}) {
  const threshold = Math.max(
    0,
    input.threshold ?? NOTEBOOK_TOOLBAR_DRAG_THRESHOLD
  );
  return Math.hypot(input.deltaX, input.deltaY) >= threshold;
}

export function getNotebookToolbarDragVelocity(
  samples: readonly NotebookToolbarPointerSample[],
  windowMs = NOTEBOOK_TOOLBAR_VELOCITY_WINDOW_MS
) {
  if (samples.length < 2) return 0;

  const last = samples[samples.length - 1];
  const cutoff = last.timeStamp - Math.max(0, windowMs);
  const first =
    samples.find((sample) => sample.timeStamp >= cutoff) ?? samples[0];
  const elapsed = last.timeStamp - first.timeStamp;
  if (elapsed <= 0) return 0;

  return Math.hypot(last.x - first.x, last.y - first.y) / elapsed;
}

export function getNotebookToolbarSettleDuration(input: {
  distance: number;
  velocity: number;
}) {
  const distance = Math.max(0, input.distance);
  const velocity = Math.max(0, input.velocity);
  const duration =
    110 + Math.min(130, distance * 0.18) - Math.min(70, velocity * 30);
  return Math.round(Math.min(240, Math.max(120, duration)));
}

export function clampNotebookToolbarDragOffset(input: {
  deltaX: number;
  deltaY: number;
  originLeft: number;
  originTop: number;
  toolbarWidth: number;
  toolbarHeight: number;
  frameWidth: number;
  frameHeight: number;
  inset?: number;
}) {
  const inset = Math.max(0, input.inset ?? 8);
  const minLeft = Math.min(inset, Math.max(0, input.frameWidth - input.toolbarWidth));
  const minTop = Math.min(inset, Math.max(0, input.frameHeight - input.toolbarHeight));
  const maxLeft = Math.max(
    minLeft,
    input.frameWidth - input.toolbarWidth - inset
  );
  const maxTop = Math.max(
    minTop,
    input.frameHeight - input.toolbarHeight - inset
  );
  const nextLeft = Math.min(
    maxLeft,
    Math.max(minLeft, input.originLeft + input.deltaX)
  );
  const nextTop = Math.min(
    maxTop,
    Math.max(minTop, input.originTop + input.deltaY)
  );

  return {
    x: nextLeft - input.originLeft,
    y: nextTop - input.originTop,
  };
}

export function getNearestNotebookToolbarDock(input: {
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  currentDock: NotebookToolbarDock;
  hysteresis?: number;
}): NotebookToolbarDock {
  const x = Math.min(Math.max(input.x, 0), Math.max(0, input.frameWidth));
  const y = Math.min(Math.max(input.y, 0), Math.max(0, input.frameHeight));
  const distances: Record<NotebookToolbarDock, number> = {
    top: y,
    right: Math.max(0, input.frameWidth - x),
    bottom: Math.max(0, input.frameHeight - y),
    left: x,
  };
  const nearestDistance = Math.min(...Object.values(distances));
  const hysteresis = Math.max(
    0,
    input.hysteresis ?? NOTEBOOK_TOOLBAR_DOCK_HYSTERESIS
  );

  if (distances[input.currentDock] <= nearestDistance + hysteresis) {
    return input.currentDock;
  }

  return NOTEBOOK_TOOLBAR_DOCKS.reduce<NotebookToolbarDock>(
    (nearestDock, dock) =>
      distances[dock] < distances[nearestDock] ? dock : nearestDock,
    "top"
  );
}
