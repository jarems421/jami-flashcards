import type { InkTimers } from "@/lib/ink-dom/hold-detector";

/**
 * A clock and timers a test moves by hand, for the parts of Jami Ink that wait
 * on time (the hold that straightens a line). `advanceTo` runs the timers that
 * fall due on the way, in order, with the clock standing at each one's time.
 */
export class InkFakeClock {
  time = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();

  readonly timers: InkTimers = {
    setTimeout: (callback, ms) => {
      const id = this.nextId;
      this.nextId += 1;
      this.pending.set(id, { at: this.time + ms, callback });
      return id;
    },
    clearTimeout: (id) => {
      this.pending.delete(id);
    },
    now: () => this.time,
  };

  get pendingCount(): number {
    return this.pending.size;
  }

  advanceTo(time: number): void {
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, timer] of this.pending) {
        if (timer.at <= time && timer.at < dueAt) {
          dueAt = timer.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const due = this.pending.get(dueId);
      this.pending.delete(dueId);
      this.time = Math.max(this.time, dueAt);
      due?.callback();
    }
    this.time = Math.max(this.time, time);
  }
}
