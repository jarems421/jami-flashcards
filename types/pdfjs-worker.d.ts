/**
 * The pdfjs worker has no types, and is imported only for its side effect.
 *
 * Server routes that read a PDF pull it in beside the main module so webpack
 * emits the chunk pdfjs will later import for its main-thread fallback. See
 * `loadPdfJs` in services/practice/exam-question-ingestion.server.ts.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
