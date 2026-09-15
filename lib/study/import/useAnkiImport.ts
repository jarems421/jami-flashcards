"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AnkiPackageResult } from "@/lib/study/import/anki-package";
import type { AnkiWorkerResponse } from "@/lib/study/import/anki-worker";

/**
 * Reads an Anki deck in a worker and hands back what is in it.
 *
 * One worker per file, closed as soon as it answers, when another file replaces
 * it, or when the dialog goes away -- a worker left running keeps its whole
 * SQLite runtime and the deck in memory for as long as the page is open.
 */
export function useAnkiReader() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    []
  );

  return useCallback(async (file: File): Promise<AnkiPackageResult> => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./anki-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const buffer = await file.arrayBuffer();
    return new Promise<AnkiPackageResult>((resolve, reject) => {
      const finish = () => {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };
      worker.onmessage = (event: MessageEvent<AnkiWorkerResponse>) => {
        finish();
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error));
      };
      worker.onerror = () => {
        finish();
        reject(new Error("The Anki reader could not start. Refresh the page and try again."));
      };
      worker.postMessage({ file: buffer, fileName: file.name }, [buffer]);
    });
  }, []);
}
