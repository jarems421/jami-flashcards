import type { NotebookTextBlock } from "@/lib/workspace/notebooks";

/**
 * A text block edit the page can reverse itself.
 *
 * Ink history is owned by js-draw and is not represented here; the two are
 * reconciled by timestamp in {@link chooseNotebookHistorySource}.
 */
export type NotebookTextHistoryEntry = {
  previous: NotebookTextBlock[];
  next: NotebookTextBlock[];
  /** When the edit happened, used to order it against ink commands. */
  at: number;
};

export type NotebookHistorySource = "ink" | "text";

export const MAX_NOTEBOOK_HISTORY_ENTRIES = 40;

/**
 * Mirrors js-draw's undo depth as a stack of timestamps.
 *
 * js-draw reports only how deep its history is, never when each command
 * landed, so the notebook keeps a parallel stack: a deeper history means a new
 * command just landed, a shallower one means commands were undone or dropped.
 */
export function syncInkHistoryTimestamps(
  timestamps: number[],
  depth: number,
  now: number
): number[] {
  if (depth < 0) return [];
  if (depth === timestamps.length) return timestamps;
  if (depth < timestamps.length) return timestamps.slice(0, depth);
  const next = timestamps.slice();
  while (next.length < depth) next.push(now);
  return next;
}

/**
 * Picks which history to step through next.
 *
 * Whichever action happened most recently wins, so undo walks back through the
 * page in the order the student actually worked. Ties go to ink, because a
 * stroke and the text edit that triggered it share a timestamp only when the
 * stroke came last.
 */
export function chooseNotebookHistorySource(input: {
  inkTimestamp: number | null;
  textTimestamp: number | null;
}): NotebookHistorySource | null {
  const { inkTimestamp, textTimestamp } = input;
  if (inkTimestamp === null && textTimestamp === null) return null;
  if (textTimestamp === null) return "ink";
  if (inkTimestamp === null) return "text";
  return inkTimestamp >= textTimestamp ? "ink" : "text";
}

/** Appends an entry, discarding the oldest once the cap is reached. */
export function pushNotebookHistoryEntry<T>(stack: T[], entry: T): T[] {
  return [...stack.slice(-(MAX_NOTEBOOK_HISTORY_ENTRIES - 1)), entry];
}
