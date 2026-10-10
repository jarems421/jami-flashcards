/**
 * The renderer's background work queue.
 *
 * Priorities, as `docs/notebook-ink.md` sets them:
 *
 * 1. live ink, drawn synchronously inside the call that carries it;
 * 2. the commit at the lift, also synchronous;
 * 3. visible tiles, nearest the middle of the screen first;
 * 4. the prefetch ring;
 * 5. idle work.
 *
 * Levels 1 and 2 never come through here: they are plain calls. Levels 3 to 5
 * are queued, run in slices of about {@link INK_SLICE_MS} with a task between
 * slices so the browser can paint, and never while a stroke or a gesture is
 * under way. Each task is told when its slice ends, so a long one (a dense
 * tile) can stop short of it and queue the rest.
 *
 * There is no DOM here: the clock and the way a slice is posted are passed
 * in, so the queue is tested in Node with a fake clock.
 */

/**
 * What a slice aims at. The gate is 4 ms; a slice can run over by the item
 * that crosses its end and the bookkeeping after it (measured at up to about
 * 1.2 ms for a dense tile, CPU slowed 4x), so it aims well short.
 */
export const INK_SLICE_MS = 2.5;

export const INK_PRIORITY_VISIBLE = 3;
export const INK_PRIORITY_PREFETCH = 4;
export const INK_PRIORITY_IDLE = 5;

export type InkTaskPriority =
  | typeof INK_PRIORITY_VISIBLE
  | typeof INK_PRIORITY_PREFETCH
  | typeof INK_PRIORITY_IDLE;

const PRIORITIES: readonly InkTaskPriority[] = [
  INK_PRIORITY_VISIBLE,
  INK_PRIORITY_PREFETCH,
  INK_PRIORITY_IDLE,
];

/** Why background work is held: a stroke in progress, or a pinch or pan. */
export type InkPauseReason = "live" | "gesture";

export type InkSchedulerOptions = {
  now: () => number;
  /** Runs `callback` in a later task (a message-channel post in the browser). */
  post: (callback: () => void) => void;
  sliceMs?: number;
  /** Told how long each slice ran and how many tasks it ran. */
  onSlice?: (durationMs: number, tasks: number) => void;
};

export type InkScheduler = {
  /**
   * Queues `run` under `key`. A key already queued is replaced (and moved to
   * the back of its new priority, or the front with `front`: a task carrying
   * on from where it stopped), so re-planning never runs a tile twice.
   * `run` is given the time (on the scheduler's clock) its slice ends.
   */
  enqueue(key: string, priority: InkTaskPriority, run: InkTask, front?: boolean): void;
  cancel(key: string): void;
  /** Drops every queued task whose key passes `test` (all of them when omitted). */
  clear(test?: (key: string) => boolean): void;
  pause(reason: InkPauseReason): void;
  resume(reason: InkPauseReason): void;
  readonly paused: boolean;
  /** Tasks waiting, at every priority. */
  readonly pending: number;
  /** Stops for good: nothing queued runs, and nothing new is accepted. */
  dispose(): void;
};

/**
 * A queued piece of work. `deadline` is when its slice ends; `first` says it
 * is the slice's first task, which must get something done. A task that
 * stops short of the deadline and queues the rest returns "yield", which ends
 * the slice.
 */
export type InkTask = (deadline: number, first: boolean) => void | "yield";

type Task = { key: string; priority: InkTaskPriority; run: InkTask };

export function createInkScheduler(options: InkSchedulerOptions): InkScheduler {
  const sliceMs = options.sliceMs ?? INK_SLICE_MS;
  // Insertion order of a Map is the run order within a priority.
  const queues = new Map<InkTaskPriority, Map<string, Task>>(
    PRIORITIES.map((priority) => [priority, new Map<string, Task>()])
  );
  const where = new Map<string, InkTaskPriority>();
  const pauses = new Set<InkPauseReason>();
  let posted = false;
  let disposed = false;

  const next = (): Task | null => {
    for (const priority of PRIORITIES) {
      const queue = queues.get(priority)!;
      const first = queue.values().next();
      if (!first.done) {
        queue.delete(first.value.key);
        where.delete(first.value.key);
        return first.value;
      }
    }
    return null;
  };

  const schedule = () => {
    if (posted || disposed || pauses.size > 0 || where.size === 0) return;
    posted = true;
    options.post(slice);
  };

  function slice() {
    posted = false;
    if (disposed || pauses.size > 0) return;
    const start = options.now();
    let tasks = 0;
    for (;;) {
      const task = next();
      if (!task) break;
      tasks += 1;
      const outcome = task.run(start + sliceMs, tasks === 1);
      // A task may pause the queue (it never should) or dispose it.
      if (disposed || pauses.size > 0 || outcome === "yield") break;
      if (options.now() - start >= sliceMs) break;
    }
    if (tasks > 0) options.onSlice?.(options.now() - start, tasks);
    schedule();
  }

  const remove = (key: string) => {
    const priority = where.get(key);
    if (priority === undefined) return;
    queues.get(priority)!.delete(key);
    where.delete(key);
  };

  return {
    enqueue(key, priority, run, front = false) {
      if (disposed) return;
      remove(key);
      const queue = queues.get(priority)!;
      if (front && queue.size > 0) {
        // A Map runs in insertion order, so the front means rebuilding it.
        const rest = Array.from(queue.values());
        queue.clear();
        queue.set(key, { key, priority, run });
        for (const task of rest) queue.set(task.key, task);
      } else {
        queue.set(key, { key, priority, run });
      }
      where.set(key, priority);
      schedule();
    },
    cancel: remove,
    clear(test) {
      for (const key of Array.from(where.keys())) {
        if (!test || test(key)) remove(key);
      }
    },
    pause(reason) {
      pauses.add(reason);
    },
    resume(reason) {
      pauses.delete(reason);
      schedule();
    },
    get paused() {
      return pauses.size > 0;
    },
    get pending() {
      return where.size;
    },
    dispose() {
      disposed = true;
      for (const queue of queues.values()) queue.clear();
      where.clear();
    },
  };
}

/**
 * Posts to a later task through a message channel: unlike `setTimeout(0)` it
 * is not clamped to 4 ms after a few nested posts, and unlike
 * `requestAnimationFrame` it does not wait for a frame.
 */
export function createInkMessagePoster(): { post: (callback: () => void) => void; close: () => void } {
  const channel = new MessageChannel();
  const waiting: Array<() => void> = [];
  channel.port1.onmessage = () => {
    const callback = waiting.shift();
    callback?.();
  };
  return {
    post(callback) {
      waiting.push(callback);
      channel.port2.postMessage(null);
    },
    close() {
      waiting.length = 0;
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
    },
  };
}
