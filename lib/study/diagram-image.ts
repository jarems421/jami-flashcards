import type { PDFDocumentProxy } from "pdfjs-dist";
import { MAX_CARD_IMAGE_BYTES } from "@/lib/study/card-images";
import type { OcclusionCrop } from "@/lib/study/image-occlusion-geometry";

/**
 * Getting a picture ready to be a diagram, in the browser.
 *
 * A phone photo is twelve megapixels and several megabytes, and every review
 * of every label downloads it. Nobody reads a label at more than about 2,400
 * pixels across, so anything larger is scaled down before upload -- which also
 * keeps it under the card image size limit. Browser-only: this draws on a
 * canvas.
 */

export const MAX_DIAGRAM_IMAGE_EDGE = 2400;
/** Past this a PNG is a photo in the wrong format; JPEG is a tenth of the size. */
const MAX_PNG_BYTES = 5 * 1024 * 1024;
const KEEP_AS_IS_BYTES = 3 * 1024 * 1024;
const STORABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type DiagramPicture = {
  file: File;
  width: number;
  height: number;
};

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // Applies the photo's EXIF rotation, so a portrait photo stays portrait.
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some formats decode as an <img> but not as a bitmap; try that next.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That picture could not be opened. Try a JPEG or PNG.");
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be prepared."))),
      type,
      quality
    );
  });
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "") || "diagram";
}

/**
 * Encode a canvas the way that suits it: PNG for a crisp diagram, JPEG when
 * PNG would be photo-sized. JPEG has no transparency, so it goes onto white --
 * what a transparent diagram is drawn on anyway.
 */
async function encode(canvas: HTMLCanvasElement, name: string, preferPng: boolean): Promise<File> {
  if (preferPng) {
    const png = await toBlob(canvas, "image/png");
    if (png.size <= MAX_PNG_BYTES) return new File([png], `${baseName(name)}.png`, { type: "image/png" });
  }
  const flattened = document.createElement("canvas");
  flattened.width = canvas.width;
  flattened.height = canvas.height;
  const context = flattened.getContext("2d");
  if (!context) throw new Error("The picture could not be prepared.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, flattened.width, flattened.height);
  context.drawImage(canvas, 0, 0);
  const jpeg = await toBlob(flattened, "image/jpeg", 0.9);
  if (jpeg.size > MAX_CARD_IMAGE_BYTES) throw new Error("That picture is too large, even scaled down.");
  return new File([jpeg], `${baseName(name)}.jpg`, { type: "image/jpeg" });
}

function drawScaled(
  decoded: Decoded,
  region: { x: number; y: number; width: number; height: number }
) {
  const scale = Math.min(1, MAX_DIAGRAM_IMAGE_EDGE / Math.max(region.width, region.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The picture could not be prepared.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    decoded.source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

/**
 * A chosen, pasted or photographed picture, ready to upload.
 *
 * Left exactly as it is when it is already a sensible size and type, so a
 * clean diagram is never recompressed for nothing.
 */
export async function prepareDiagramPicture(blob: Blob, name = "diagram"): Promise<DiagramPicture> {
  if (!blob.type.startsWith("image/")) throw new Error("Choose a picture: a JPEG, PNG or WebP image.");
  const decoded = await decode(blob);
  try {
    const { width, height } = decoded;
    if (!width || !height) throw new Error("That picture is empty.");
    const fits =
      Math.max(width, height) <= MAX_DIAGRAM_IMAGE_EDGE &&
      blob.size <= KEEP_AS_IS_BYTES &&
      STORABLE_TYPES.includes(blob.type);
    if (fits) {
      const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type });
      return { file, width, height };
    }
    const canvas = drawScaled(decoded, { x: 0, y: 0, width, height });
    const file = await encode(canvas, name, blob.type === "image/png");
    return { file, width: canvas.width, height: canvas.height };
  } finally {
    decoded.close();
  }
}

/** A picture's own size in pixels, before any scaling. */
export async function measurePicture(blob: Blob): Promise<{ width: number; height: number }> {
  const decoded = await decode(blob);
  try {
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

/** Big enough to read small print on a diagram, small enough to send quickly. */
const DETECTION_EDGE = 1600;

/**
 * A picture as a model reads it: JPEG, no larger than it needs to be, base64.
 *
 * Boxes come back as fractions of the picture, so shrinking it moves nothing.
 */
export async function encodeForLabelDetection(file: Blob): Promise<{ mimeType: string; data: string }> {
  const decoded = await decode(file);
  try {
    const scale = Math.min(1, DETECTION_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The picture could not be prepared.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, "image/jpeg", 0.88);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return { mimeType: "image/jpeg", data: btoa(binary) };
  } finally {
    decoded.close();
  }
}

/** The part of a picture inside a crop, as a new picture. */
export async function cropDiagramPicture(
  picture: DiagramPicture,
  crop: OcclusionCrop
): Promise<DiagramPicture> {
  const decoded = await decode(picture.file);
  try {
    const region = {
      x: crop.x * decoded.width,
      y: crop.y * decoded.height,
      width: crop.width * decoded.width,
      height: crop.height * decoded.height,
    };
    const canvas = drawScaled(decoded, region);
    const file = await encode(canvas, picture.file.name, picture.file.type === "image/png");
    return { file, width: canvas.width, height: canvas.height };
  } finally {
    decoded.close();
  }
}

/**
 * One page of a PDF as a picture, to crop a diagram out of.
 *
 * Drawn at the size a diagram is stored at rather than the size it is shown,
 * so the crop keeps the detail. The PDF itself is only read.
 */
export async function renderPdfPagePicture(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  name: string
): Promise<DiagramPicture> {
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = MAX_DIAGRAM_IMAGE_EDGE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This page could not be drawn.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const file = await encode(canvas, `${baseName(name)}-page-${pageNumber}`, true);
    return { file, width: canvas.width, height: canvas.height };
  } finally {
    page.cleanup();
  }
}
