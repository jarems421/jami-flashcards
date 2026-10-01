import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNotebookInkBusy,
  NOTEBOOK_INK_IDLE_GRACE_MS,
  NOTEBOOK_INK_MAX_HOLD_MS,
  paceNotebookInkWork,
  resetNotebookInkActivityForTests,
  setNotebookInkContact,
  untilNotebookInkIdle,
  whenNotebookInkIdle,
} from "@/lib/workspace/notebook-ink-activity";

/** Resolves after any message already posted has been delivered. */
function nextMessage() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

describe("notebook ink activity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNotebookInkActivityForTests();
  });

  afterEach(() => {
    resetNotebookInkActivityForTests();
    vi.useRealTimers();
  });

  it("runs waiting work straight away when no pen is down", () => {
    const work = vi.fn();
    whenNotebookInkIdle(work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(isNotebookInkBusy()).toBe(false);
  });

  it("holds work while a pen is down and for a moment after it lifts", () => {
    const pen = {};
    setNotebookInkContact(pen, true);
    const work = vi.fn();
    whenNotebookInkIdle(work);
    expect(isNotebookInkBusy()).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(work).not.toHaveBeenCalled();

    setNotebookInkContact(pen, false);
    // Still busy through the gap between two strokes of one word.
    vi.advanceTimersByTime(NOTEBOOK_INK_IDLE_GRACE_MS - 1);
    expect(work).not.toHaveBeenCalled();
    expect(isNotebookInkBusy()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(isNotebookInkBusy()).toBe(false);
  });

  it("keeps holding when the next stroke starts inside the grace period", () => {
    const pen = {};
    const work = vi.fn();
    setNotebookInkContact(pen, true);
    whenNotebookInkIdle(work);
    setNotebookInkContact(pen, false);
    vi.advanceTimersByTime(NOTEBOOK_INK_IDLE_GRACE_MS / 2);
    setNotebookInkContact(pen, true);
    vi.advanceTimersByTime(NOTEBOOK_INK_IDLE_GRACE_MS);
    expect(work).not.toHaveBeenCalled();

    setNotebookInkContact(pen, false);
    vi.advanceTimersByTime(NOTEBOOK_INK_IDLE_GRACE_MS);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("waits for every surface's pen, and ignores an end nobody started", () => {
    const notebook = {};
    const practiceSheet = {};
    const work = vi.fn();
    setNotebookInkContact(notebook, true);
    setNotebookInkContact(practiceSheet, true);
    whenNotebookInkIdle(work);

    setNotebookInkContact(notebook, false);
    setNotebookInkContact({}, false);
    vi.advanceTimersByTime(NOTEBOOK_INK_IDLE_GRACE_MS * 2);
    expect(work).not.toHaveBeenCalled();

    setNotebookInkContact(practiceSheet, false);
    vi.advanceTimersByTime(NOTEBOOK_INK_IDLE_GRACE_MS);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("never holds work forever if a contact is never ended", () => {
    setNotebookInkContact({}, true);
    const work = vi.fn();
    whenNotebookInkIdle(work);
    vi.advanceTimersByTime(NOTEBOOK_INK_MAX_HOLD_MS - 1);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("drops work cancelled while it waits", () => {
    const pen = {};
    setNotebookInkContact(pen, true);
    const work = vi.fn();
    const cancel = whenNotebookInkIdle(work);
    cancel();
    setNotebookInkContact(pen, false);
    vi.advanceTimersByTime(NOTEBOOK_INK_MAX_HOLD_MS);
    expect(work).not.toHaveBeenCalled();
  });

  it("resolves the promise form once the pen settles", async () => {
    const pen = {};
    setNotebookInkContact(pen, true);
    let settled = false;
    const waiting = untilNotebookInkIdle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    setNotebookInkContact(pen, false);
    await vi.advanceTimersByTimeAsync(NOTEBOOK_INK_IDLE_GRACE_MS);
    await waiting;
    expect(settled).toBe(true);
  });

  it("only pauses long work at slice boundaries", async () => {
    // Between boundaries the pacer returns without scheduling anything.
    await expect(paceNotebookInkWork(5, 24)).resolves.toBeUndefined();

    const pen = {};
    setNotebookInkContact(pen, true);
    let resumed = false;
    const paced = paceNotebookInkWork(24, 24).then(() => {
      resumed = true;
    });
    // A new task first (a message, which fake timers do not control), then
    // the wait for the pen.
    await nextMessage();
    await vi.advanceTimersByTimeAsync(10);
    expect(resumed).toBe(false);

    setNotebookInkContact(pen, false);
    await vi.advanceTimersByTimeAsync(NOTEBOOK_INK_IDLE_GRACE_MS);
    await paced;
    expect(resumed).toBe(true);
  });
});
