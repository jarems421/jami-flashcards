import { describe, expect, it, vi } from "vitest";
import type { Editor as JsDrawEditor } from "js-draw";
import { dispatchPreciseNotebookPointerMove } from "@/lib/workspace/notebook-direct-ink-input";

describe("direct notebook ink input", () => {
  it("dispatches every exact move without a minimum-distance gate", () => {
    const pointer = { id: 7, screenPos: { x: 0.35, y: 0.4 } };
    const onPointerEvent = vi.fn();
    const dispatchInputEvent = vi.fn(() => true);
    const ofEvent = vi.fn(() => pointer);
    const viewport = {};
    const surface = {} as HTMLElement;
    const event = {
      clientX: 0.35,
      clientY: 0.4,
      pointerId: 7,
    } as PointerEvent;

    const handled = dispatchPreciseNotebookPointerMove({
      editor: {
        display: { onPointerEvent } as unknown as JsDrawEditor["display"],
        toolController: {
          dispatchInputEvent,
        } as unknown as JsDrawEditor["toolController"],
        viewport: viewport as JsDrawEditor["viewport"],
      },
      event,
      jsDraw: {
        InputEvtType: {
          PointerMoveEvt: 1,
        } as typeof import("js-draw")["InputEvtType"],
        Pointer: {
          ofEvent,
        } as unknown as typeof import("js-draw")["Pointer"],
      },
      surface,
    });

    expect(handled).toBe(true);
    expect(onPointerEvent).toHaveBeenCalledWith(event);
    expect(ofEvent).toHaveBeenCalledWith(event, true, viewport, surface);
    expect(dispatchInputEvent).toHaveBeenCalledWith({
      kind: 1,
      current: pointer,
      allPointers: [pointer],
    });
  });
});
