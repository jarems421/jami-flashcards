import "server-only";

import { readFileSync } from "node:fs";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { downscale, encodePng, toRgb } from "@/lib/evaluation/pdf-page-image";

/**
 * Scanned pages, loaded and turned into something a marker can look at.
 *
 * The reading and decoding live here rather than in `lib/` because they are
 * file and library I/O; the encoding itself is pure and stays where it can be
 * tested without a PDF.
 *
 * Only the images the page actually paints are extracted. Rendering the page
 * would need a canvas library and would reproduce the furniture — rules,
 * headers, the question number — around work that is already a photograph.
 */

/** `…/evidence.pdf#page=4-6` -> the file and the pages it names. */
export function parsePageReference(reference: string) {
  const [file, fragment] = reference.split("#page=");
  if (!fragment) return { file, firstPage: 1, lastPage: 1 };
  const [from, to] = fragment.split("-").map((value) => Number(value));
  const firstPage = Number.isFinite(from) && from > 0 ? from : 1;
  const lastPage = Number.isFinite(to) && to >= firstPage ? to : firstPage;
  return { file, firstPage, lastPage };
}

export type ScannedPageOptions = {
  /** Integer reduction. Two keeps handwriting legible at a tenth the bytes. */
  downscaleBy?: number;
  /** Refuse a reference that would send more than this many images. */
  maxImages?: number;
};

/**
 * The images on the pages a record points at.
 *
 * Returns an empty array rather than throwing when a page carries no image:
 * the caller decides whether a record with no visible work is worth marking,
 * and that decision does not belong to a loader.
 */
export async function loadScannedPages(
  reference: string,
  options: ScannedPageOptions = {}
): Promise<AiContentPart[]> {
  const { file, firstPage, lastPage } = parsePageReference(reference);
  const factor = options.downscaleBy ?? 2;
  const maxImages = options.maxImages ?? 4;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) });
  const document = await task.promise;
  const parts: AiContentPart[] = [];

  try {
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      if (pageNumber > document.numPages || parts.length >= maxImages) break;
      const page = await document.getPage(pageNumber);
      const operators = await page.getOperatorList();

      for (let index = 0; index < operators.fnArray.length; index += 1) {
        if (parts.length >= maxImages) break;
        const operator = operators.fnArray[index];
        if (operator !== pdfjs.OPS.paintImageXObject) continue;
        const name = operators.argsArray[index][0];
        // Image objects resolve asynchronously; asking for one before the
        // worker has decoded it throws rather than waiting.
        const object = await new Promise<{
          width: number;
          height: number;
          data: Uint8Array;
        } | null>((resolve) => {
          try {
            page.objs.get(name, resolve);
          } catch {
            resolve(null);
          }
        });
        if (!object?.data || !object.width || !object.height) continue;

        try {
          const png = encodePng(downscale(toRgb(object), factor));
          parts.push({
            inlineData: { mimeType: "image/png", data: png.toString("base64") },
          });
        } catch {
          // A layout this cannot read is skipped rather than sent as noise.
        }
      }
    }
  } finally {
    await task.destroy();
  }

  return parts;
}
