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
  /**
   * Take only the work sitting beneath this label, e.g. `Candidate 5`.
   *
   * A quarter of these pages carry two candidates, and sending both asks a
   * marker to judge one script while looking at somebody else's. The label
   * printed above each piece of work is what says whose it is, so an image is
   * kept when the nearest label above it is this one.
   */
  belowLabel?: string;
};

/** A label printed on the page, with where it sits. Higher y is further up. */
type PageLabel = { text: string; y: number };

/**
 * The vertical band a label owns: from the label down to the next one.
 *
 * Returns null when the label is not on the page, which the caller must treat
 * as "cannot identify this candidate's work" rather than "take everything".
 */
export function labelBand(labels: readonly PageLabel[], wanted: string) {
  const ordered = [...labels].sort((a, b) => b.y - a.y);
  const index = ordered.findIndex(
    (label) => label.text.replace(/\s+/g, " ").trim().toLowerCase() === wanted.toLowerCase()
  );
  if (index === -1) return null;
  return { top: ordered[index].y, bottom: ordered[index + 1]?.y ?? Number.NEGATIVE_INFINITY };
}

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

      // Where each piece of work sits, so it can be attributed to whoever the
      // page says wrote it.
      let band: { top: number; bottom: number } | null = null;
      if (options.belowLabel) {
        const content = await page.getTextContent();
        const labels: PageLabel[] = (
          content.items as { str?: string; transform?: number[] }[]
        )
          .filter((item) => /^(Candidate|Question)\s+\d+/.test((item.str ?? "").trim()))
          .map((item) => ({ text: (item.str ?? "").trim(), y: item.transform?.[5] ?? 0 }));
        band = labelBand(labels, options.belowLabel);
        // The label is not on this page, so nothing here can be shown to be
        // theirs. Sending the page anyway is what this option exists to stop.
        if (!band) continue;
      }

      // An image's placement lives in the transformation matrix in force when
      // it is painted, so the matrix has to be tracked to know where it landed.
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];

      for (let index = 0; index < operators.fnArray.length; index += 1) {
        if (parts.length >= maxImages) break;
        const operator = operators.fnArray[index];
        if (operator === pdfjs.OPS.save) {
          stack.push([...matrix]);
          continue;
        }
        if (operator === pdfjs.OPS.restore) {
          matrix = stack.pop() ?? matrix;
          continue;
        }
        if (operator === pdfjs.OPS.transform) {
          const [a, b, c, d, e, f] = operators.argsArray[index] as number[];
          const [a0, b0, c0, d0, e0, f0] = matrix;
          matrix = [
            a * a0 + b * c0,
            a * b0 + b * d0,
            c * a0 + d * c0,
            c * b0 + d * d0,
            e * a0 + f * c0 + e0,
            e * b0 + f * d0 + f0,
          ];
          continue;
        }
        if (operator !== pdfjs.OPS.paintImageXObject) continue;

        if (band) {
          const bottom = matrix[5];
          const top = bottom + Math.abs(matrix[3]);
          // Attributed to the nearest label above it, which is this one only
          // when the work starts below the label and above the next.
          if (top > band.top || top <= band.bottom) continue;
        }
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
