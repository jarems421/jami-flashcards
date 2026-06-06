export const MAX_NOTEBOOK_PDF_PAGES = 200;

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsPromise: Promise<PdfJsModule> | null = null;

export async function loadNotebookPdfJs() {
  pdfJsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    return pdfjs;
  });
  return pdfJsPromise;
}

export function validateNotebookPdfPageCount(pageCount: number) {
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    throw new Error("This PDF does not contain any readable pages.");
  }
  if (pageCount > MAX_NOTEBOOK_PDF_PAGES) {
    throw new Error(
      `PDF notebooks support up to ${MAX_NOTEBOOK_PDF_PAGES} pages.`
    );
  }
  return Math.round(pageCount);
}

export function buildUploadedNotebookPageMappings(input: {
  pageCount: number;
  fileId: string;
  isPdf: boolean;
}) {
  const pageCount = validateNotebookPdfPageCount(input.pageCount);
  const fileId = input.fileId.trim();
  if (!fileId) throw new Error("Missing notebook file.");
  return Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    title: `Page ${index + 1}`,
    backgroundFileId: fileId,
    pdfPageIndex: input.isPdf ? index : undefined,
  }));
}

export function getNotebookPdfRenderMetrics(input: {
  pageWidth: number;
  pageHeight: number;
  hostWidth: number;
  hostHeight: number;
  pixelRatio: number;
  maxPixelRatio?: number;
}) {
  const maxPixelRatio = input.maxPixelRatio ?? 2;
  const cssScale = Math.min(
    Math.max(1, input.hostWidth) / Math.max(1, input.pageWidth),
    Math.max(1, input.hostHeight) / Math.max(1, input.pageHeight)
  );
  const pixelRatio = Math.min(
    maxPixelRatio,
    Math.max(1, input.pixelRatio || 1)
  );
  return {
    cssScale,
    pixelRatio,
    canvasWidth: Math.max(
      1,
      Math.floor(input.pageWidth * cssScale * pixelRatio)
    ),
    canvasHeight: Math.max(
      1,
      Math.floor(input.pageHeight * cssScale * pixelRatio)
    ),
    cssWidth: input.pageWidth * cssScale,
    cssHeight: input.pageHeight * cssScale,
  };
}

export function resolveNotebookPageBackgroundFileId(input: {
  pageBackgroundFileId?: string;
  notebookUploadedFileId?: string;
  firstFileId?: string;
  hasMappedPages?: boolean;
}) {
  if (input.pageBackgroundFileId) return input.pageBackgroundFileId;
  if (input.hasMappedPages) return undefined;
  return input.notebookUploadedFileId ?? input.firstFileId;
}

export async function getNotebookPdfPageCount(file: File) {
  if (file.type !== "application/pdf") return 1;
  try {
    const pdfjs = await loadNotebookPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const pageCount = validateNotebookPdfPageCount(pdf.numPages);
    await loadingTask.destroy();
    return pageCount;
  } catch (error) {
    const name =
      typeof error === "object" && error && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (name === "PasswordException") {
      throw new Error("Password-protected PDFs are not supported.");
    }
    if (
      error instanceof Error &&
      (error.message.includes("up to") || error.message.includes("readable pages"))
    ) {
      throw error;
    }
    throw new Error("This PDF could not be opened. Choose a valid PDF file.");
  }
}
