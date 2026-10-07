import { describe, expect, it } from "vitest";
import { forEachLimited } from "@/lib/async/for-each-limited";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("forEachLimited", () => {
  it("never has more than the limit in flight, and starts them in list order", async () => {
    const started: number[] = [];
    let inFlight = 0;
    let most = 0;
    await forEachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      started.push(item);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it("carries on past a task that fails", async () => {
    const done: number[] = [];
    await forEachLimited([1, 2, 3], 1, async (item) => {
      if (item === 2) throw new Error("no");
      done.push(item);
    });
    expect(done).toEqual([1, 3]);
  });

  it("starts nothing new once told to stop", async () => {
    const started: number[] = [];
    let stop = false;
    const first = deferred();
    const run = forEachLimited(
      [1, 2, 3],
      1,
      async (item) => {
        started.push(item);
        if (item === 1) await first.promise;
      },
      () => stop
    );
    stop = true;
    first.resolve();
    await run;
    expect(started).toEqual([1]);
  });

  it("does nothing for an empty list", async () => {
    let calls = 0;
    await forEachLimited([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
