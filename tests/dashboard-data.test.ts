import { describe, expect, it, vi } from "vitest";
import { runDashboardDataRequest } from "@/lib/app/dashboard-data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("runDashboardDataRequest", () => {
  it("applies and settles the current request", async () => {
    const apply = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(
      runDashboardDataRequest({
        load: async () => ({ value: "ready" }),
        isCurrent: () => true,
        apply,
        onError,
        onSettled,
      })
    ).resolves.toBe("applied");

    expect(apply).toHaveBeenCalledWith({ value: "ready" });
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("reports and settles a failure from the current request", async () => {
    const error = new Error("load failed");
    const apply = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(
      runDashboardDataRequest({
        load: async () => {
          throw error;
        },
        isCurrent: () => true,
        apply,
        onError,
        onSettled,
      })
    ).resolves.toBe("failed");

    expect(apply).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("ignores a stale success without ending the current load", async () => {
    const apply = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(
      runDashboardDataRequest({
        load: async () => ({ value: "old" }),
        isCurrent: () => false,
        apply,
        onError,
        onSettled,
      })
    ).resolves.toBe("stale");

    expect(apply).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("ignores a stale failure", async () => {
    const apply = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();

    await expect(
      runDashboardDataRequest({
        load: async () => {
          throw new Error("old failure");
        },
        isCurrent: () => false,
        apply,
        onError,
        onSettled,
      })
    ).resolves.toBe("stale");

    expect(apply).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("lets only the newest overlapping request update the page", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const applied: string[] = [];
    const settled: number[] = [];
    let activeRequest = 1;

    const olderRun = runDashboardDataRequest({
      load: () => older.promise,
      isCurrent: () => activeRequest === 1,
      apply: (value) => applied.push(value),
      onError: () => undefined,
      onSettled: () => settled.push(1),
    });

    activeRequest = 2;
    const newerRun = runDashboardDataRequest({
      load: () => newer.promise,
      isCurrent: () => activeRequest === 2,
      apply: (value) => applied.push(value),
      onError: () => undefined,
      onSettled: () => settled.push(2),
    });

    newer.resolve("newer");
    await expect(newerRun).resolves.toBe("applied");
    older.resolve("older");
    await expect(olderRun).resolves.toBe("stale");

    expect(applied).toEqual(["newer"]);
    expect(settled).toEqual([2]);
  });
});
