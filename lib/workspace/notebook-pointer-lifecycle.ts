const INTENTIONAL_CAPTURE_LOSS_WINDOW_MS = 250;

type ActivePointer = {
  generation: number;
};

type PendingCaptureLoss = {
  expiresAt: number;
};

export type NotebookPointerStart = {
  generation: number;
  shouldCancelStaleGesture: boolean;
};

export type NotebookCaptureLossDecision =
  | { kind: "ignore-intentional" }
  | { kind: "ignore-inactive" }
  | { kind: "cancel-active"; generation: number };

/**
 * Tracks stylus contacts independently from the browser's pointer-capture
 * timing. Safari can deliver an intentional `lostpointercapture` after the same
 * Pencil pointer ID has already started its next stroke.
 */
export class NotebookInkPointerLifecycle {
  private activePointers = new Map<number, ActivePointer>();
  private pendingCaptureLosses = new Map<number, PendingCaptureLoss[]>();
  private nextGeneration = 0;

  get activeCount() {
    return this.activePointers.size;
  }

  get isInteracting() {
    return this.activePointers.size > 0;
  }

  begin(pointerId: number): NotebookPointerStart {
    const shouldCancelStaleGesture = this.activePointers.size > 0;
    this.activePointers.clear();
    const generation = this.nextGeneration + 1;
    this.nextGeneration = generation;
    this.activePointers.set(pointerId, { generation });
    return { generation, shouldCancelStaleGesture };
  }

  finish(input: {
    pointerId: number;
    expectCaptureLoss: boolean;
    timeStamp: number;
  }) {
    const wasActive = this.activePointers.delete(input.pointerId);
    if (wasActive && input.expectCaptureLoss) {
      const pending = this.pendingCaptureLosses.get(input.pointerId) ?? [];
      pending.push({
        expiresAt: input.timeStamp + INTENTIONAL_CAPTURE_LOSS_WINDOW_MS,
      });
      this.pendingCaptureLosses.set(input.pointerId, pending);
    }
    return wasActive && this.activePointers.size === 0;
  }

  handleLostCapture(
    pointerId: number,
    timeStamp: number
  ): NotebookCaptureLossDecision {
    const pending = (this.pendingCaptureLosses.get(pointerId) ?? []).filter(
      (entry) => entry.expiresAt >= timeStamp
    );
    if (pending.length > 0) {
      pending.shift();
      if (pending.length > 0) {
        this.pendingCaptureLosses.set(pointerId, pending);
      } else {
        this.pendingCaptureLosses.delete(pointerId);
      }
      return { kind: "ignore-intentional" };
    }
    this.pendingCaptureLosses.delete(pointerId);

    const active = this.activePointers.get(pointerId);
    return active
      ? { kind: "cancel-active", generation: active.generation }
      : { kind: "ignore-inactive" };
  }

  isCurrent(pointerId: number, generation: number) {
    return this.activePointers.get(pointerId)?.generation === generation;
  }

  reset() {
    this.activePointers.clear();
    this.pendingCaptureLosses.clear();
  }
}
