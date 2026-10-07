"use client";

import { useCallback, useRef, type RefObject } from "react";
import type { Editor as JsDrawEditor } from "js-draw";
import { NOTEBOOK_INK_WARM_SNAPSHOT_IDLE_MS } from "@/lib/workspace/notebook-autosave";
import { paceNotebookInkWork } from "@/lib/workspace/notebook-ink-activity";

/** How many strokes an export writes before letting the browser in. */
const EXPORT_SLICE_COMPONENTS = 24;

/**
 * The page's ink as SVG, exported at most once per change.
 *
 * Three callers want this after every pause: the recovery draft (350ms), the
 * swipe snapshot (600ms) and the autosave (5s). Each used to run its own full
 * export, so every pause between words cost three -- and on a dense page each
 * one is real work on the main thread. Now the first caller starts it, the
 * others join it or read its result, and nothing is exported again until the
 * ink changes.
 *
 * An export whose ink changes underneath it is abandoned and answers null,
 * which every caller already treats as "not now": a stroke-old SVG is no use to
 * the save, which throws away anything older than the page anyway.
 *
 * A snapshot is also prepared once the page has been still for a moment, so a
 * swipe can read a finished SVG rather than paying for one on the pointermove
 * that starts it. It is put off while a pointer is down.
 */
export function useNotebookInkSnapshots({
  editorRef,
  readyRef,
  isInteracting,
}: {
  editorRef: RefObject<JsDrawEditor | null>;
  readyRef: RefObject<boolean>;
  isInteracting: () => boolean;
}) {
  /** The prepared snapshot, and whether ink has changed since it was taken. */
  const warmSvgRef = useRef<string | null>(null);
  const warmStaleRef = useRef(true);
  const warmTimerRef = useRef<number | null>(null);
  const warmVersionRef = useRef(0);
  /** The export in progress, and which version of the ink it is of. */
  const exportRef = useRef<{
    version: number;
    promise: Promise<string | null>;
  } | null>(null);

  const exportCurrentInk = useCallback((): Promise<string | null> => {
    const editor = editorRef.current;
    if (!editor || !readyRef.current) return Promise.resolve(null);
    if (!warmStaleRef.current && warmSvgRef.current !== null) {
      return Promise.resolve(warmSvgRef.current);
    }
    const version = warmVersionRef.current;
    const inFlight = exportRef.current;
    if (inFlight && inFlight.version === version) return inFlight.promise;

    let abandoned = false;
    const promise = editor
      .toSVGAsync({
        // Never js-draw's frame-aligned pause; the pacing below replaces it.
        pauseAfterCount: Number.MAX_SAFE_INTEGER,
        onProgress: async (processed) => {
          await paceNotebookInkWork(processed, EXPORT_SLICE_COMPONENTS);
          if (version !== warmVersionRef.current || editorRef.current !== editor) {
            abandoned = true;
            return false;
          }
          return true;
        },
      })
      .then((svg) => {
        if (abandoned || version !== warmVersionRef.current || editorRef.current !== editor) {
          return null;
        }
        const html = svg.outerHTML;
        warmSvgRef.current = html;
        warmStaleRef.current = false;
        return html;
      })
      .finally(() => {
        if (exportRef.current?.promise === promise) exportRef.current = null;
      });
    exportRef.current = { version, promise };
    return promise;
  }, [editorRef, readyRef]);

  const scheduleWarmSnapshot = useCallback(() => {
    const arm = () => {
      if (warmTimerRef.current !== null) window.clearTimeout(warmTimerRef.current);
      warmTimerRef.current = window.setTimeout(() => {
        warmTimerRef.current = null;
        if (!editorRef.current || !readyRef.current) return;
        // A pen is down: wait for it to lift and the page to be still again.
        if (isInteracting()) {
          arm();
          return;
        }
        void exportCurrentInk().catch(() => undefined);
      }, NOTEBOOK_INK_WARM_SNAPSHOT_IDLE_MS);
    };
    arm();
  }, [editorRef, exportCurrentInk, isInteracting, readyRef]);

  /** The ink changed: every snapshot is out of date, and a new one is prepared once the page is still. */
  const noteInkChanged = useCallback(() => {
    warmVersionRef.current += 1;
    warmStaleRef.current = true;
    scheduleWarmSnapshot();
  }, [scheduleWarmSnapshot]);

  /** A snapshot of the ink exactly as it is now, if one has been taken. */
  const currentSnapshot = useCallback(
    () => (warmStaleRef.current ? null : warmSvgRef.current),
    []
  );

  /** Forgets every snapshot and abandons any export, for an editor being taken down. */
  const discardSnapshots = useCallback(() => {
    if (warmTimerRef.current !== null) {
      window.clearTimeout(warmTimerRef.current);
      warmTimerRef.current = null;
    }
    warmSvgRef.current = null;
    warmStaleRef.current = true;
    warmVersionRef.current += 1;
    exportRef.current = null;
  }, []);

  return { exportCurrentInk, scheduleWarmSnapshot, noteInkChanged, currentSnapshot, discardSnapshots };
}
