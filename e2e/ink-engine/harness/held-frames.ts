/**
 * Animation frames the harness holds back, so the warm-up's canvas stays on
 * screen as long as a test wants it there. Passed to the renderer as its
 * `requestFrame` and `cancelFrame`.
 */
export type HeldFrames = {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  /** Frames asked for and not yet released. */
  readonly pending: number;
  /** Lets every held frame happen, and those they ask for in turn. */
  release: () => void;
};

export function holdFrames(): HeldFrames {
  const waiting = new Map<number, () => void>();
  let next = 1;
  return {
    requestFrame(callback) {
      const id = next;
      next += 1;
      waiting.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      waiting.delete(id);
    },
    get pending() {
      return waiting.size;
    },
    release() {
      while (waiting.size > 0) {
        const [id, callback] = waiting.entries().next().value!;
        waiting.delete(id);
        callback();
      }
    },
  };
}
