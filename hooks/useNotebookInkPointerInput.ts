"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Editor as JsDrawEditor } from "js-draw";
import type { NotebookInkEditorRefs } from "@/hooks/useNotebookInkEditorRefs";
import {
  dispatchPreciseNotebookPointerMove,
  getJsDrawPointerReferenceElement,
  getPredictedTipCanvasPoints,
} from "@/lib/workspace/notebook-direct-ink-input";
import {
  getContinuousNotebookEraserSamples,
  getNotebookEraserCursorDiameter,
  getNotebookEraserToolThickness,
  getSpatiallySimplifiedNotebookEraserSamples,
  type NotebookEraserPointerSample,
} from "@/lib/workspace/notebook-eraser";
import {
  getBoundedLivePointerSamples,
  shouldUseNotebookPenPressure,
} from "@/lib/workspace/notebook-inking";
import {
  dispatchBatchedNotebookPointerSamples,
  getNotebookContactTool,
  getNotebookInkPointerOrigins,
  installNotebookNativeInkGuards,
  positionNotebookEraserCursor,
  shouldContinueNotebookPrecisionGesture,
  shouldExpectNotebookCaptureLoss,
  shouldUseNotebookPrecisionGesture,
  type NotebookInkPointerEventType,
  type NotebookInkPointerOrigins,
} from "@/lib/workspace/notebook-ink-runtime";
import type { NotebookInkRenderWindow } from "@/lib/workspace/notebook-ink-window";
import { shouldSuppressNotebookNativeInkPointer } from "@/lib/workspace/notebook-interaction-lock";
import {
  applyNotebookEraserMode,
  applyNotebookNibThickness,
  type JsDrawModule,
  type NotebookInkStyle,
  type NotebookInkTool,
} from "@/lib/workspace/notebook-js-draw";
import { NotebookPrecisionEraserGesture } from "@/lib/workspace/notebook-precision-eraser";
import { NotebookPredictedTip } from "@/lib/workspace/notebook-predicted-tip";
import {
  applyNotebookScribbleErase,
  planNotebookScribbleErase,
} from "@/lib/workspace/notebook-scribble-gesture";
import type { NotebookScribbleSample } from "@/lib/workspace/notebook-scribble-erase";

/**
 * Enough samples for any scribble, and a bound on the buffer.
 *
 * At roughly one per frame this is about half a minute of continuous drawing.
 * The earlier 512 was under ten seconds, which a vigorous scribble over a
 * block of several lines can genuinely exceed -- and exceeding it silently
 * turned the gesture off for that stroke.
 */
const MAX_SCRIBBLE_SAMPLES = 2048;

type ActivePrecisionEraserGesture = {
  cursorDiameter: number;
  gesture: NotebookPrecisionEraserGesture;
  lastSample: NotebookEraserPointerSample;
  pointerId: number;
  origins: NotebookInkPointerOrigins;
};

type SurfacePointerHandler = (event: ReactPointerEvent<HTMLDivElement>) => void;

/**
 * Routes pointers on the ink surface: the pen, highlighter and eraser into
 * js-draw, and everything ink does not take -- touch, the text tool, a
 * read-only page -- to the page's own handlers.
 *
 * Every non-touch tool draws directly through js-draw, so the ink the user
 * sees while writing is the exact ink that is kept and saved. Touch always
 * falls through to the page handlers (fingers navigate, stylus writes).
 *
 * Holds what only lasts as long as a contact -- which tool it borrowed, its
 * scribble path, where the page was when it began, a precision erase in
 * progress -- and lets every bit of it go when the contact ends, is cancelled,
 * or loses its capture, or when the window is left behind.
 */
export function useNotebookInkPointerInput({
  refs,
  style,
  readOnly,
  scribbleToErase,
  inkWindow,
  reportInteraction,
  page,
}: {
  refs: NotebookInkEditorRefs;
  style: NotebookInkStyle;
  readOnly: boolean;
  /** Scribbling out with the pen deletes the strokes it covers. */
  scribbleToErase: boolean;
  inkWindow: NotebookInkRenderWindow | null;
  reportInteraction: (active: boolean) => void;
  /** The page's handlers, for pointers ink does not take. */
  page: {
    onPointerDown: SurfacePointerHandler;
    onPointerMove: SurfacePointerHandler;
    onPointerUp: SurfacePointerHandler;
    onPointerCancel: SurfacePointerHandler;
  };
}) {
  const {
    hostRef,
    inkSurfaceRef,
    eraserCursorRef,
    editorRef,
    jsDrawRef,
    readyRef,
    liveInkRef,
    penPreviewBatchRef,
    pointerLifecycleRef,
    inkSmoothersRef,
    nibAngleRef,
    liveTipRef,
    styleSyncRef,
  } = refs;
  const {
    activeTool,
    eraserMode,
    eraserThickness,
    highlighterColor,
    highlighterThickness,
    penColor,
    penSettings,
    penThickness,
  } = style;
  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } = page;

  const eraserOriginsRef = useRef<NotebookInkPointerOrigins | null>(null);
  const eraserCursorDiameterRef = useRef(getNotebookEraserCursorDiameter(eraserThickness));
  const lastForwardedPointerSampleRef = useRef<Map<number, PointerEvent>>(new Map());
  /**
   * Where js-draw's render region sat when the current pen stroke began.
   *
   * Read once at contact and reused for every move of that stroke -- see
   * `referenceRect` in notebook-direct-ink-input. Forgotten on release, and
   * whenever anything scrolls, resizes or re-windows the page, so a stroke
   * never measures against a position the page has left.
   */
  const strokeRegionRectRef = useRef<{ pointerId: number; rect: DOMRect } | null>(null);
  const precisionEraserGestureRef = useRef<ActivePrecisionEraserGesture | null>(null);
  /**
   * The tool each pen contact is working with, by pointer id.
   *
   * Usually the selected tool. A pen turned over to its eraser end borrows
   * the eraser for that one contact -- see `getNotebookContactTool`.
   */
  const contactToolsRef = useRef<Map<number, NotebookInkTool>>(new Map());
  /**
   * The live pen path, for recognising a scribble-out at release.
   *
   * Bounded: a long stroke cannot be a scribble anyway, and this sits in a
   * pointer handler that runs at the Pencil's full rate.
   */
  const scribbleSamplesRef = useRef<{
    pointerId: number;
    samples: NotebookScribbleSample[];
  } | null>(null);

  useLayoutEffect(() => {
    const surface = inkSurfaceRef.current;
    if (!surface) return;

    // WebKit can decide that a fast horizontal Pencil stroke is a native
    // navigation gesture before React's delegated pointer handler runs. An
    // active, non-passive capture listener on the real ink target closes
    // that timing gap without affecting finger page navigation.
    return installNotebookNativeInkGuards(surface, (event) =>
      shouldSuppressNotebookNativeInkPointer({
        activeTool,
        pointerType: event.pointerType,
        readOnly,
      })
    );
  }, [activeTool, inkSurfaceRef, readOnly]);

  const cancelEditorGesture = useCallback(() => {
    inkSmoothersRef.current.clear();
    lastForwardedPointerSampleRef.current.clear();
    strokeRegionRectRef.current = null;
    scribbleSamplesRef.current = null;
    const liveTip = liveTipRef.current;
    liveTip.contact = null;
    liveTip.points = null;
    liveTip.shown = false;
    precisionEraserGestureRef.current?.gesture.cancel();
    precisionEraserGestureRef.current = null;
    eraserOriginsRef.current = null;
    if (eraserCursorRef.current) {
      eraserCursorRef.current.style.opacity = "0";
    }
    const editor = editorRef.current;
    const jsDraw = jsDrawRef.current;
    if (editor && jsDraw) {
      editor.toolController.dispatchInputEvent({
        kind: jsDraw.InputEvtType.GestureCancelEvt,
      });
    }
    // After the cancel, which is what wipes the unfinished stroke.
    liveInkRef.current?.end();
  }, [editorRef, eraserCursorRef, inkSmoothersRef, jsDrawRef, liveInkRef, liveTipRef]);

  /**
   * Forgets every contact, for an editor being built or taken down. The
   * editor's own gesture goes with it, so there is nothing to cancel in it.
   */
  const resetPointerState = useCallback(() => {
    pointerLifecycleRef.current?.reset();
    inkSmoothersRef.current.clear();
    lastForwardedPointerSampleRef.current.clear();
    precisionEraserGestureRef.current?.gesture.cancel();
    precisionEraserGestureRef.current = null;
    eraserOriginsRef.current = null;
  }, [inkSmoothersRef, pointerLifecycleRef]);

  useEffect(() => {
    const cancelInteractions = () => {
      cancelEditorGesture();
      contactToolsRef.current.clear();
      const pointerLifecycle = pointerLifecycleRef.current;
      const wasInteracting = pointerLifecycle?.isInteracting ?? false;
      pointerLifecycle?.reset();
      if (!wasInteracting) return;
      reportInteraction(false);
      if (eraserCursorRef.current) {
        eraserCursorRef.current.style.opacity = "0";
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") cancelInteractions();
    };
    window.addEventListener("blur", cancelInteractions);
    window.addEventListener("pagehide", cancelInteractions);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", cancelInteractions);
      window.removeEventListener("pagehide", cancelInteractions);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cancelEditorGesture, eraserCursorRef, pointerLifecycleRef, reportInteraction]);

  useEffect(() => {
    // Capturing scroll on the window hears every scroller on the page, not
    // just the document, since scroll events do not bubble.
    const forgetStrokeRegion = () => {
      strokeRegionRectRef.current = null;
    };
    const scrollOptions: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("scroll", forgetStrokeRegion, scrollOptions);
    window.addEventListener("resize", forgetStrokeRegion);
    return () => {
      window.removeEventListener("scroll", forgetStrokeRegion, scrollOptions);
      window.removeEventListener("resize", forgetStrokeRegion);
    };
  }, []);

  useEffect(() => {
    strokeRegionRectRef.current = null;
  }, [inkWindow]);

  const finishPointerInteraction = useCallback(
    (input: { pointerId: number; expectCaptureLoss?: boolean; timeStamp: number }) => {
      const endedInteraction =
        pointerLifecycleRef.current?.finish({
          pointerId: input.pointerId,
          expectCaptureLoss: input.expectCaptureLoss ?? false,
          timeStamp: input.timeStamp,
        }) ?? false;
      if (!endedInteraction) return;
      reportInteraction(false);
      const editor = editorRef.current;
      const jsDraw = jsDrawRef.current;
      if (editor && jsDraw) styleSyncRef.current?.applyDeferred(editor, jsDraw);
    },
    [editorRef, jsDrawRef, pointerLifecycleRef, reportInteraction, styleSyncRef]
  );

  /**
   * Gives js-draw this contact's tool, with what depends on the moment
   * rather than on the style: pressure for a stylus, the nib at the current
   * zoom, and the eraser's mode and size.
   */
  const prepareEditorForContact = useCallback((
    editor: JsDrawEditor,
    jsDraw: JsDrawModule,
    tool: NotebookInkTool,
    pointerType: string
  ) => {
    const pointerStyle: NotebookInkStyle = {
      activeTool: tool,
      eraserMode,
      eraserThickness,
      highlighterColor,
      highlighterThickness,
      penColor,
      penSettings,
      penThickness,
    };
    const styleSync = styleSyncRef.current;
    if (styleSync) {
      // What the toolbar asks for, which is what comes back once a pen
      // turned over to erase is turned the right way up again.
      styleSync.desired = { ...pointerStyle, activeTool };
      styleSync.applyForContact(editor, pointerStyle, jsDraw);
    }
    const primaryPen = editor.toolController.getMatchingTools(jsDraw.PenTool)[0];
    if (primaryPen) {
      const pressureEnabled =
        tool === "pen" &&
        shouldUseNotebookPenPressure({
          maxTouchPoints: navigator.maxTouchPoints,
          platform: navigator.platform,
          pointerType,
          userAgent: navigator.userAgent,
        });
      if (primaryPen.getPressureSensitivityEnabled() !== pressureEnabled) {
        primaryPen.setPressureSensitivityEnabled(pressureEnabled);
      }
    }
    // The nib is set in page units but js-draw wants screen pixels, so
    // its value depends on the current zoom -- which changes without the
    // style changing, and so would otherwise be missed by the equality
    // check above. Reasserting it here pins the mark to the page.
    applyNotebookNibThickness(editor, pointerStyle, jsDraw);
    // Reassert mutable eraser state at contact time. Precision routing no
    // longer trusts js-draw's mode, but Stroke mode still uses its tool.
    if (tool === "eraser") {
      applyNotebookEraserMode(editor, eraserMode, jsDraw);
      editor.toolController
        .getMatchingTools(jsDraw.EraserTool)[0]
        ?.setThickness(getNotebookEraserToolThickness(eraserThickness));
    }
  }, [
    activeTool,
    eraserMode,
    eraserThickness,
    highlighterColor,
    highlighterThickness,
    penColor,
    penSettings,
    penThickness,
    styleSyncRef,
  ]);

  /**
   * The precision eraser, which erases what the ring actually covers rather
   * than whole strokes, routed apart from js-draw's own eraser tool.
   */
  const routePrecisionEraser = useCallback((
    type: NotebookInkPointerEventType,
    event: ReactPointerEvent<HTMLDivElement>,
    editor: JsDrawEditor,
    eraserOrigins: NotebookInkPointerOrigins | null
  ) => {
    if (type === "pointerdown" && eraserOrigins && jsDrawRef.current) {
      const sample = {
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: event.timeStamp,
      };
      const cursorDiameter = getNotebookEraserCursorDiameter(eraserThickness);
      const gesture = new NotebookPrecisionEraserGesture(editor, jsDrawRef.current, cursorDiameter);
      precisionEraserGestureRef.current = {
        cursorDiameter,
        gesture,
        lastSample: sample,
        pointerId: event.pointerId,
        origins: eraserOrigins,
      };
      gesture.begin({
        x: sample.clientX - eraserOrigins.region.left,
        y: sample.clientY - eraserOrigins.region.top,
      });
      return;
    }
    const activeGesture = precisionEraserGestureRef.current;
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) return;
    if (type === "pointercancel") {
      activeGesture.gesture.cancel();
      precisionEraserGestureRef.current = null;
      return;
    }
    const samples = getContinuousNotebookEraserSamples(event.nativeEvent, activeGesture.lastSample);
    const spatialSamples = getSpatiallySimplifiedNotebookEraserSamples(samples, activeGesture.lastSample);
    activeGesture.gesture.moveBatch(
      spatialSamples.map((sample) => ({
        x: sample.clientX - activeGesture.origins.region.left,
        y: sample.clientY - activeGesture.origins.region.top,
      }))
    );
    const latestSample = samples[samples.length - 1];
    if (latestSample) activeGesture.lastSample = latestSample;
    if (type === "pointerup") {
      activeGesture.gesture.finish();
      precisionEraserGestureRef.current = null;
      const selectedDiameter = getNotebookEraserCursorDiameter(eraserThickness);
      eraserCursorDiameterRef.current = selectedDiameter;
      const cursor = eraserCursorRef.current;
      if (cursor) {
        cursor.style.width = `${selectedDiameter}px`;
        cursor.style.height = `${selectedDiameter}px`;
      }
    }
  }, [eraserCursorRef, eraserThickness, jsDrawRef]);

  /** Hands a pointer to ink. Answers false when ink does not take it, so the page should. */
  const forwardInkPointer = useCallback((
    type: NotebookInkPointerEventType,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    // Read before any of the branching below, so the edge keeps following
    // the hand through gestures that never reach js-draw at all. Non-pen
    // pointers and pens reporting no orientation are ignored inside.
    if (type === "pointerdown" || type === "pointermove") {
      nibAngleRef.current?.observe(event.nativeEvent);
    }
    // Decided once, at contact, and kept for the whole of it: which end of
    // the pen touched down does not change mid-stroke, whatever `buttons`
    // reports on the way. Touch never draws, so it never takes a slot.
    const contactTools = contactToolsRef.current;
    if (type === "pointerdown" && event.pointerType !== "touch") {
      contactTools.set(
        event.pointerId,
        getNotebookContactTool({
          activeTool,
          buttons: event.buttons,
          pointerType: event.pointerType,
        })
      );
    }
    const tool = contactTools.get(event.pointerId) ?? activeTool;
    const existingPrecisionGesture = precisionEraserGestureRef.current;
    const continuesPrecisionGesture = shouldContinueNotebookPrecisionGesture({
      activePointerId: existingPrecisionGesture?.pointerId,
      pointerId: event.pointerId,
      type,
    });
    // A gesture owns its pointer until release/cancellation. Props can change
    // while Pencil is still down (for example via a finger toolbar tap), but
    // its provisional split must still be finished or restored.
    if (
      type === "pointerdown" &&
      existingPrecisionGesture &&
      event.pointerType !== "touch" &&
      (tool === "text" || readOnly)
    ) {
      const strandedPointerId = existingPrecisionGesture.pointerId;
      cancelEditorGesture();
      finishPointerInteraction({
        pointerId: strandedPointerId,
        timeStamp: event.timeStamp,
      });
      try {
        if (event.currentTarget.hasPointerCapture(strandedPointerId)) {
          event.currentTarget.releasePointerCapture(strandedPointerId);
        }
      } catch {
        // Safari may already have discarded the stranded capture.
      }
    }
    if (!continuesPrecisionGesture && (event.pointerType === "touch" || tool === "text" || readOnly)) {
      return false;
    }
    event.preventDefault();
    const precisionEraserSelected = tool === "eraser" && eraserMode === "precision";
    const precisionEraserActive = shouldUseNotebookPrecisionGesture({
      continuing: continuesPrecisionGesture,
      precisionEraserSelected,
    });
    const surface = event.currentTarget;
    // js-draw measures its own events against a region inside this host, not
    // against the surface the handlers sit on. See notebook-direct-ink-input.
    const host = hostRef.current;
    const inkRegion = getJsDrawPointerReferenceElement(host);
    let eraserOrigins: NotebookInkPointerOrigins | null = null;
    if (tool === "eraser") {
      const activePrecisionGesture = precisionEraserGestureRef.current;
      if (type === "pointerdown") {
        // Refresh once at contact in case the page moved or the viewport
        // changed since Pencil hover entered the surface.
        eraserOrigins = getNotebookInkPointerOrigins(surface, inkRegion);
        eraserOriginsRef.current = eraserOrigins;
      } else if (activePrecisionGesture?.pointerId === event.pointerId) {
        eraserOrigins = activePrecisionGesture.origins;
      } else {
        eraserOrigins = eraserOriginsRef.current;
      }
      // Pointer enter normally primes the cache. Keep this one-read fallback
      // for browsers that begin a captured Pencil stream without hover.
      if (!eraserOrigins) {
        eraserOrigins = getNotebookInkPointerOrigins(surface, inkRegion);
        eraserOriginsRef.current = eraserOrigins;
      }
      // js-draw measures eraser thickness in screen pixels. Keep the DOM ring
      // in the same coordinate space so the visible boundary is authoritative.
      const diameter = getNotebookEraserCursorDiameter(eraserThickness);
      const cursorDiameter =
        continuesPrecisionGesture && existingPrecisionGesture ? existingPrecisionGesture.cursorDiameter : diameter;
      const cursor = eraserCursorRef.current;
      if (cursor) {
        eraserCursorDiameterRef.current = positionNotebookEraserCursor({
          clientX: event.clientX,
          clientY: event.clientY,
          cursor,
          cursorDiameter,
          previousDiameter: eraserCursorDiameterRef.current,
          surfaceLeft: eraserOrigins.surface.left,
          surfaceTop: eraserOrigins.surface.top,
        });
      }
    }
    if (!readyRef.current) return true;
    const editor = editorRef.current;
    const liveTip = liveTipRef.current;
    if (type === "pointerdown") {
      const jsDraw = jsDrawRef.current;
      if (editor && jsDraw) {
        // A clean pointerdown can go straight to js-draw. Only cancel when a
        // previous contact is genuinely stranded; cancelling every new
        // stroke creates a race with rapid Pencil re-contact on Safari.
        const pointerStart = pointerLifecycleRef.current?.begin(event.pointerId);
        if (pointerStart?.shouldCancelStaleGesture) {
          cancelEditorGesture();
          eraserOriginsRef.current = eraserOrigins;
          if (eraserCursorRef.current && tool === "eraser") {
            eraserCursorRef.current.style.opacity = "1";
          }
        }
        prepareEditorForContact(editor, jsDraw, tool, event.pointerType);
      }
      if (!precisionEraserSelected) {
        lastForwardedPointerSampleRef.current.set(event.pointerId, event.nativeEvent);
      }
      liveTip.points = null;
      // A stylus only. A mouse is not writing, and touch never draws.
      if (tool === "pen" && event.pointerType === "pen") {
        const tracker = liveTip.contact?.tracker ?? new NotebookPredictedTip();
        tracker.reset();
        tracker.observe([{ x: event.clientX, y: event.clientY, time: event.timeStamp }]);
        liveTip.contact = { pointerId: event.pointerId, tracker };
      } else {
        liveTip.contact = null;
      }
      if (tool === "pen" || tool === "highlighter") {
        // js-draw has just measured the page for this contact itself, so the
        // layout is clean and this read costs nothing.
        const regionRect = inkRegion ? inkRegion.getBoundingClientRect() : null;
        strokeRegionRectRef.current = regionRect ? { pointerId: event.pointerId, rect: regionRect } : null;
        if (regionRect) {
          liveInkRef.current?.begin({
            surfaceRect: surface.getBoundingClientRect(),
            regionRect,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            pointer: { clientX: event.clientX, clientY: event.clientY },
          });
        }
      }
      if (scribbleToErase && tool === "pen") {
        // Raw client coordinates. Recognising a scribble does not need to
        // know where the page is, and asking would force a layout flush at
        // the start of every stroke.
        scribbleSamplesRef.current = {
          pointerId: event.pointerId,
          samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }],
        };
      } else {
        scribbleSamplesRef.current = null;
      }
      try {
        if (!surface.hasPointerCapture(event.pointerId)) {
          surface.setPointerCapture(event.pointerId);
        }
      } catch {
        // Safari can reject capture on rapid stylus re-contact; keep drawing.
      }
      reportInteraction(true);
    }
    const pointerJsDraw = jsDrawRef.current;
    const scribbleTrack = scribbleSamplesRef.current;
    if (scribbleTrack?.pointerId === event.pointerId && (type === "pointermove" || type === "pointerup")) {
      scribbleTrack.samples.push({ x: event.clientX, y: event.clientY, time: event.timeStamp });
      // Past the cap the gesture has run far longer than any scribble, and a
      // truncated path cannot be judged honestly. Stop watching this stroke.
      if (scribbleTrack.samples.length > MAX_SCRIBBLE_SAMPLES) {
        scribbleSamplesRef.current = null;
      }
    }

    /*
     * A scribble is answered before the release reaches js-draw.
     *
     * Cancelling the pen's gesture discards the stroke in progress, so the
     * scribble never becomes a component and never enters the undo history:
     * one press of undo brings back what was erased, with nothing left over.
     * A scribble over blank paper plans nothing and commits as ordinary ink.
     */
    if (
      type === "pointerup" &&
      editor &&
      pointerJsDraw &&
      scribbleSamplesRef.current?.pointerId === event.pointerId &&
      scribbleTrack
    ) {
      const plan = planNotebookScribbleErase({
        editor,
        jsDraw: pointerJsDraw,
        getSurfaceOffset: () => getNotebookInkPointerOrigins(surface, inkRegion).region,
        samples: scribbleTrack.samples,
        strokeWidth: penThickness,
      });
      scribbleSamplesRef.current = null;
      if (plan) {
        cancelEditorGesture();
        applyNotebookScribbleErase(editor, pointerJsDraw, plan);
        finishPointerInteraction({ pointerId: event.pointerId, timeStamp: event.timeStamp });
        try {
          if (surface.hasPointerCapture(event.pointerId)) {
            surface.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Capture may already be gone; the interaction is finished either way.
        }
        inkSmoothersRef.current.delete(event.pointerId);
        lastForwardedPointerSampleRef.current.delete(event.pointerId);
        contactTools.delete(event.pointerId);
        return true;
      }
    }
    if (type === "pointerup" || type === "pointercancel") {
      scribbleSamplesRef.current = null;
    }
    if (editor) {
      if (precisionEraserActive) {
        routePrecisionEraser(type, event, editor, eraserOrigins);
      } else if (
        type === "pointermove" &&
        (tool === "pen" || tool === "highlighter") &&
        pointerJsDraw &&
        host &&
        /*
         * Only while this contact is actually down.
         *
         * A Pencil reports pointermove as it hovers, before it has touched
         * anything and after it has left, and a mouse reports it whenever it
         * crosses the page. Without this, every one of those was fed to
         * js-draw as drawing input on the fast path below -- so the stroke
         * went on growing after the pen had been lifted, following it through
         * the air.
         *
         * `buttons` is the second half of it. A contact can end without this
         * component seeing the up -- capture lost to a system gesture, a
         * pointer cancelled out from under it -- and the browser is the only
         * one that always knows whether anything is currently pressed.
         */
        pointerLifecycleRef.current?.isDown(event.pointerId) &&
        event.buttons !== 0
      ) {
        // Safari groups high-frequency Pencil input into coalesced packets.
        // Feed those exact points through js-draw's normal tool pipeline,
        // bypassing only its coarse two-CSS-pixel move filter. The wet canvas
        // is repainted once, immediately, after the whole packet is added.
        const liveSamples = getBoundedLivePointerSamples(
          event.nativeEvent,
          lastForwardedPointerSampleRef.current.get(event.pointerId)
        );
        const previewBatch = penPreviewBatchRef.current;
        const strokeRegion = strokeRegionRectRef.current;
        const referenceRect = strokeRegion?.pointerId === event.pointerId ? strokeRegion.rect : null;
        const tipContact = liveTip.contact;
        liveTip.points =
          tool === "pen" && tipContact?.pointerId === event.pointerId
            ? getPredictedTipCanvasPoints({
                editor,
                event: event.nativeEvent,
                jsDraw: pointerJsDraw,
                referenceRect,
                samples: liveSamples,
                tracker: tipContact.tracker,
              })
            : null;
        const paintsBefore = liveTip.paints;
        dispatchBatchedNotebookPointerSamples({
          batch: previewBatch ?? undefined,
          samples: liveSamples,
          dispatch: (sample) => {
            dispatchPreciseNotebookPointerMove({
              editor,
              event: sample,
              host,
              jsDraw: pointerJsDraw,
              referenceRect,
            });
          },
        });
        // js-draw paints nothing for a packet the lift-off gate is holding,
        // or while it judges the pen to be resting -- which would leave the
        // last tip standing beyond where the line now ends. Paint again, so
        // the tip moves on with the line or goes.
        if (liveTip.paints === paintsBefore && liveTip.shown) {
          previewBatch?.paintNow();
        }
        lastForwardedPointerSampleRef.current.set(event.pointerId, event.nativeEvent);
      } else {
        if (type === "pointerup" || type === "pointercancel") {
          // The stroke ends where it was really drawn to, never at a guess.
          liveTip.points = null;
        }
        editor.handleHTMLPointerEvent(type, event.nativeEvent);
        if (type === "pointerdown" && (tool === "pen" || tool === "highlighter")) {
          // Show contact immediately instead of waiting for the first move.
          penPreviewBatchRef.current?.paintNow();
        }
        if (type === "pointerup" || type === "pointercancel") {
          // js-draw has committed the stroke and drawn it onto the page;
          // hand its wet ink back.
          liveInkRef.current?.end();
        }
      }
    }
    if (type === "pointercancel") {
      // js-draw normalizes pointercancel to pointerup. Explicitly cancel its
      // gesture too so an iPadOS navigation cancellation cannot leave an
      // input filter active and delay the next Pencil stroke.
      cancelEditorGesture();
    }
    if (type === "pointerup" || type === "pointercancel") {
      inkSmoothersRef.current.delete(event.pointerId);
      lastForwardedPointerSampleRef.current.delete(event.pointerId);
      contactTools.delete(event.pointerId);
      // An eraser end borrowed the eraser for this contact only. Put the
      // selected tool back as the contact finishes, rather than leaving
      // js-draw holding the eraser until the next one begins.
      if (tool !== activeTool) styleSyncRef.current?.defer();
      if (strokeRegionRectRef.current?.pointerId === event.pointerId) {
        strokeRegionRectRef.current = null;
      }
      if (liveTip.contact?.pointerId === event.pointerId) {
        // js-draw cleared its live ink as the stroke committed, tip and all.
        liveTip.contact = null;
        liveTip.points = null;
        liveTip.shown = false;
      }
      let hadPointerCapture = false;
      try {
        hadPointerCapture = surface.hasPointerCapture(event.pointerId);
      } catch {
        // Capture state may be unavailable after a browser cancellation.
      }
      // Mark the release before capture is dropped. Safari can dispatch the
      // resulting lostpointercapture after the next contact has begun. A
      // pointercancel also ends implicit capture, even when Safari has
      // already stopped reporting it through hasPointerCapture().
      finishPointerInteraction({
        pointerId: event.pointerId,
        expectCaptureLoss: shouldExpectNotebookCaptureLoss(type, hadPointerCapture),
        timeStamp: event.timeStamp,
      });
      try {
        if (hadPointerCapture) {
          surface.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Capture may already be gone; interaction cleanup still runs.
      }
    }
    return true;
  }, [
    activeTool,
    cancelEditorGesture,
    editorRef,
    eraserCursorRef,
    eraserMode,
    eraserThickness,
    finishPointerInteraction,
    hostRef,
    inkSmoothersRef,
    jsDrawRef,
    liveInkRef,
    liveTipRef,
    nibAngleRef,
    penPreviewBatchRef,
    penThickness,
    pointerLifecycleRef,
    prepareEditorForContact,
    readOnly,
    readyRef,
    reportInteraction,
    routePrecisionEraser,
    scribbleToErase,
    styleSyncRef,
  ]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!forwardInkPointer("pointerdown", event)) onPointerDown(event);
    },
    [forwardInkPointer, onPointerDown]
  );
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!forwardInkPointer("pointermove", event)) onPointerMove(event);
    },
    [forwardInkPointer, onPointerMove]
  );
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!forwardInkPointer("pointerup", event)) onPointerUp(event);
    },
    [forwardInkPointer, onPointerUp]
  );
  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!forwardInkPointer("pointercancel", event)) onPointerCancel(event);
    },
    [forwardInkPointer, onPointerCancel]
  );
  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activeTool !== "eraser") return;
      eraserOriginsRef.current = getNotebookInkPointerOrigins(
        event.currentTarget,
        getJsDrawPointerReferenceElement(hostRef.current)
      );
    },
    [activeTool, hostRef]
  );
  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        onPointerCancel(event);
        return;
      }
      const pointerId = event.pointerId;
      const decision = pointerLifecycleRef.current?.handleLostCapture(pointerId, event.timeStamp);
      if (decision?.kind !== "cancel-active") return;
      if (!pointerLifecycleRef.current?.isCurrent(pointerId, decision.generation)) {
        return;
      }
      cancelEditorGesture();
      contactToolsRef.current.delete(pointerId);
      finishPointerInteraction({ pointerId, timeStamp: event.timeStamp });
    },
    [cancelEditorGesture, finishPointerInteraction, onPointerCancel, pointerLifecycleRef]
  );
  const handlePointerLeave = useCallback(() => {
    if (eraserCursorRef.current) {
      eraserCursorRef.current.style.opacity = "0";
    }
    if (!pointerLifecycleRef.current?.isInteracting) {
      eraserOriginsRef.current = null;
    }
  }, [eraserCursorRef, pointerLifecycleRef]);

  /*
   * React sizes the eraser ring from the chosen thickness. A precision erase
   * in progress keeps the size it began with, which the gesture sets on the
   * ring directly, so a thickness changed mid-erase is put back before paint.
   */
  useLayoutEffect(() => {
    const gesture = precisionEraserGestureRef.current;
    const cursor = eraserCursorRef.current;
    if (!gesture || !cursor) return;
    cursor.style.width = `${gesture.cursorDiameter}px`;
    cursor.style.height = `${gesture.cursorDiameter}px`;
  }, [activeTool, eraserCursorRef, eraserThickness]);

  return {
    /** For the ink surface element. */
    surfaceHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onPointerEnter: handlePointerEnter,
      onLostPointerCapture: handleLostPointerCapture,
      onPointerLeave: handlePointerLeave,
    },
    resetPointerState,
    /** The eraser ring's size for the chosen thickness. */
    eraserCursorDiameter: getNotebookEraserCursorDiameter(eraserThickness),
  };
}
