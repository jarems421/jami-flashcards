import { decompress } from "fzstd";
import initSqlJs from "sql.js";
import { AnkiPackageError, readAnkiPackage, type AnkiPackageResult } from "@/lib/study/import/anki-package";

/**
 * Reads an Anki deck off the main thread.
 *
 * Unzipping and querying a large collection takes long enough to freeze the
 * page, so it happens here. SQLite's WebAssembly is served from the app itself
 * (`public/sql-wasm.wasm`, copied from the package on install), never a CDN.
 */

export type AnkiWorkerRequest = { file: ArrayBuffer; fileName: string };
export type AnkiWorkerResponse = { ok: true; result: AnkiPackageResult } | { ok: false; error: string };

let sqlReady: ReturnType<typeof initSqlJs> | null = null;

self.onmessage = async (event: MessageEvent<AnkiWorkerRequest>) => {
  let response: AnkiWorkerResponse;
  try {
    sqlReady ??= initSqlJs({ locateFile: (file) => `/${file}` });
    const result = await readAnkiPackage(event.data.file, {
      sql: await sqlReady,
      decompressZstd: (data) => decompress(data),
      fallbackName: event.data.fileName.replace(/\.apkg$/i, ""),
    });
    response = { ok: true, result };
  } catch (error) {
    // The real cause, for whoever is debugging; the student is shown the message below.
    console.error("Anki import failed", error);
    response = {
      ok: false,
      error:
        error instanceof AnkiPackageError
          ? error.message
          : "This Anki deck could not be read. Try exporting it from Anki again.",
    };
  }
  postMessage(response);
};
