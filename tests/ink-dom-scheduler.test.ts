import { describe, expect, it } from "vitest";
import {
  createInkScheduler,
  INK_PRIORITY_IDLE,
  INK_PRIORITY_PREFETCH,
  INK_PRIORITY_VISIBLE,
  INK_SLICE_MS,
} from "@/lib/ink-dom/scheduler";

function setup(sliceMs = INK_SLICE_MS) {
  let time = 0;
  const posted: Array<() => void> = [];
  const slices: Array<{ ms: number; tasks: number }> = [];
  const scheduler = createInkScheduler({
    now: () => time,
    post: (callback) => posted.push(callback),
    sliceMs,
    onSlice: (ms, tasks) => slices.push({ ms, tasks }),
  });
  return {
    scheduler,
    slices,
    posted,
    advance: (ms: number) => {
      time += ms;
    },
    /** Runs the next posted slice; false when nothing was posted. */
    step: () => {
      const next = posted.shift();
      next?.();
      return next !== undefined;
    },
  };
}

describe("createInkScheduler", () => {
  it("runs visible work before the prefetch ring, and the ring before idle work", () => {
    const { scheduler, step } = setup();
    const ran: string[] = [];
    scheduler.enqueue("idle", INK_PRIORITY_IDLE, () => void ran.push("idle"));
    scheduler.enqueue("ring", INK_PRIORITY_PREFETCH, () => void ran.push("ring"));
    scheduler.enqueue("a", INK_PRIORITY_VISIBLE, () => void ran.push("a"));
    scheduler.enqueue("b", INK_PRIORITY_VISIBLE, () => void ran.push("b"));
    while (step());
    expect(ran).toEqual(["a", "b", "ring", "idle"]);
    expect(scheduler.pending).toBe(0);
  });

  it("runs a key once, at its latest priority, when it is queued again", () => {
    const { scheduler, step } = setup();
    const ran: string[] = [];
    scheduler.enqueue("tile", INK_PRIORITY_PREFETCH, () => void ran.push("old"));
    scheduler.enqueue("other", INK_PRIORITY_PREFETCH, () => void ran.push("other"));
    scheduler.enqueue("tile", INK_PRIORITY_VISIBLE, () => void ran.push("new"));
    while (step());
    expect(ran).toEqual(["new", "other"]);
  });

  it("ends a slice once its budget is spent, and posts the next", () => {
    const { scheduler, step, slices, advance, posted } = setup(4);
    const ran: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      scheduler.enqueue(`t${i}`, INK_PRIORITY_VISIBLE, () => {
        ran.push(i);
        advance(1.5);
      });
    }
    expect(posted).toHaveLength(1);
    step();
    expect(ran).toEqual([0, 1, 2]);
    expect(slices[0]).toEqual({ ms: 4.5, tasks: 3 });
    expect(posted).toHaveLength(1);
    while (step());
    expect(ran).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("puts a task carrying on from where it stopped at the front of its priority", () => {
    const { scheduler, step } = setup();
    const ran: string[] = [];
    scheduler.enqueue("a", INK_PRIORITY_VISIBLE, () => void ran.push("a"));
    scheduler.enqueue("b", INK_PRIORITY_VISIBLE, () => void ran.push("b"));
    scheduler.enqueue("started", INK_PRIORITY_VISIBLE, () => void ran.push("started"), true);
    scheduler.enqueue("ring", INK_PRIORITY_PREFETCH, () => void ran.push("ring"), true);
    while (step());
    expect(ran).toEqual(["started", "a", "b", "ring"]);
  });

  it("tells each task when its slice ends and whether it is the slice's first", () => {
    const { scheduler, step, advance } = setup(3);
    const seen: Array<[number, boolean]> = [];
    advance(10);
    for (const key of ["a", "b"]) {
      scheduler.enqueue(key, INK_PRIORITY_VISIBLE, (deadline, first) => {
        seen.push([deadline, first]);
        advance(1);
      });
    }
    step();
    expect(seen).toEqual([
      [13, true],
      [13, false],
    ]);
  });

  it("ends the slice when a task yields, so one that stops early is not run again at once", () => {
    const { scheduler, step, slices } = setup(4);
    const ran: string[] = [];
    let parts = 3;
    const resumable = (): void | "yield" => {
      ran.push("part");
      parts -= 1;
      if (parts > 0) {
        scheduler.enqueue("tile", INK_PRIORITY_VISIBLE, resumable);
        return "yield";
      }
    };
    scheduler.enqueue("tile", INK_PRIORITY_VISIBLE, resumable);
    scheduler.enqueue("other", INK_PRIORITY_VISIBLE, () => void ran.push("other"));
    step();
    expect(ran).toEqual(["part"]);
    while (step());
    expect(ran).toEqual(["part", "other", "part", "part"]);
    expect(slices.length).toBeGreaterThanOrEqual(3);
  });

  it("holds everything while a stroke or a gesture is under way, and resumes after both", () => {
    const { scheduler, step, posted } = setup();
    const ran: string[] = [];
    scheduler.pause("live");
    scheduler.enqueue("a", INK_PRIORITY_VISIBLE, () => void ran.push("a"));
    expect(posted).toHaveLength(0);
    scheduler.pause("gesture");
    scheduler.resume("live");
    expect(scheduler.paused).toBe(true);
    expect(posted).toHaveLength(0);
    scheduler.resume("gesture");
    expect(scheduler.paused).toBe(false);
    while (step());
    expect(ran).toEqual(["a"]);
  });

  it("stops part way through a slice when a task pauses it", () => {
    const { scheduler, step } = setup();
    const ran: string[] = [];
    scheduler.enqueue("a", INK_PRIORITY_VISIBLE, () => {
      ran.push("a");
      scheduler.pause("live");
    });
    scheduler.enqueue("b", INK_PRIORITY_VISIBLE, () => void ran.push("b"));
    step();
    expect(ran).toEqual(["a"]);
    expect(scheduler.pending).toBe(1);
  });

  it("cancels, clears by key and disposes", () => {
    const { scheduler, step } = setup();
    const ran: string[] = [];
    for (const key of ["v1", "v2", "p1", "p2"]) scheduler.enqueue(key, INK_PRIORITY_VISIBLE, () => void ran.push(key));
    scheduler.cancel("v1");
    scheduler.clear((key) => key.startsWith("p"));
    expect(scheduler.pending).toBe(1);
    while (step());
    expect(ran).toEqual(["v2"]);
    scheduler.dispose();
    scheduler.enqueue("late", INK_PRIORITY_VISIBLE, () => void ran.push("late"));
    while (step());
    expect(ran).toEqual(["v2"]);
  });
});
