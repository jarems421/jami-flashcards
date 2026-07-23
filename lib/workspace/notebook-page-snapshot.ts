"use client";

import type {
  NotebookPageColor,
  NotebookPageStyle,
  NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

export const NOTEBOOK_PAGE_SNAPSHOT_SCALE = 2;
export const NOTEBOOK_PAGE_SNAPSHOT_FALLBACK_SCALE = 1.6;
export const NOTEBOOK_PAGE_SNAPSHOT_MAX_ENCODED_BYTES = 2_500_000;

const NOTEBOOK_PAGE_SNAPSHOT_WEBP_QUALITY = 0.92;
const NOTEBOOK_TEXT_FONT_SIZE = 22;
const NOTEBOOK_TEXT_LINE_HEIGHT = 32;
const NOTEBOOK_TEXT_PADDING = 12;

export type NotebookPageSnapshotBackground =
  | {
      kind: "pdf-canvas";
      canvas: HTMLCanvasElement;
    }
  | {
      kind: "image-bytes";
      bytes: Uint8Array;
      mimeType: string;
    };

export type RenderNotebookPageSnapshotInput = {
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  inkSvg: string;
  textBlocks: readonly NotebookTextBlock[];
  background?: NotebookPageSnapshotBackground | null;
  /** Intended for request-size enforcement and focused tests. */
  maxEncodedBytes?: number;
};

export type RenderedNotebookPageSnapshot = {
  blob: Blob;
  encodedBytes: number;
  height: number;
  mimeType: "image/webp" | "image/png";
  scale: number;
  typedText: string;
  width: number;
};

export type NotebookSnapshotContainRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type NotebookSnapshotPaperPattern = {
  backgroundColor: string;
  dotCenters: ReadonlyArray<{ x: number; y: number }>;
  horizontalLines: readonly number[];
  lineColor: string;
  verticalLines: readonly number[];
};

type DecodedCanvasSource = {
  height: number;
  release(): void;
  source: CanvasImageSource;
  width: number;
};

type EncodedCanvas = {
  blob: Blob;
  mimeType: "image/webp" | "image/png";
};

export class NotebookPageSnapshotError extends Error {
  readonly code:
    | "canvas_unavailable"
    | "image_decode_failed"
    | "invalid_background"
    | "snapshot_too_large";

  constructor(
    code: NotebookPageSnapshotError["code"],
    message: string
  ) {
    super(message);
    this.name = "NotebookPageSnapshotError";
    this.code = code;
  }
}

export function getNotebookSnapshotContainRect(input: {
  containerHeight: number;
  containerWidth: number;
  sourceHeight: number;
  sourceWidth: number;
}): NotebookSnapshotContainRect {
  const containerWidth = Math.max(1, input.containerWidth);
  const containerHeight = Math.max(1, input.containerHeight);
  const sourceWidth = Math.max(1, input.sourceWidth);
  const sourceHeight = Math.max(1, input.sourceHeight);
  const scale = Math.min(
    containerWidth / sourceWidth,
    containerHeight / sourceHeight
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function getNotebookSnapshotPaperPattern(
  pageColor: NotebookPageColor,
  pageStyle: NotebookPageStyle,
  width = NOTEBOOK_PAGE_COORDINATE_WIDTH,
  height = NOTEBOOK_PAGE_COORDINATE_HEIGHT
): NotebookSnapshotPaperPattern {
  const horizontalLines: number[] = [];
  const verticalLines: number[] = [];
  const dotCenters: Array<{ x: number; y: number }> = [];
  const boundedWidth = Math.max(1, width);
  const boundedHeight = Math.max(1, height);

  if (pageStyle === "lined") {
    for (let y = 40; y < boundedHeight; y += 40) horizontalLines.push(y);
  } else if (pageStyle === "grid") {
    for (let x = 0; x < boundedWidth; x += 40) verticalLines.push(x);
    for (let y = 0; y < boundedHeight; y += 40) horizontalLines.push(y);
  } else if (pageStyle === "dot") {
    for (let y = 14; y < boundedHeight; y += 28) {
      for (let x = 14; x < boundedWidth; x += 28) {
        dotCenters.push({ x, y });
      }
    }
  }

  return {
    backgroundColor: pageColor === "black" ? "#080a10" : "#ffffff",
    lineColor:
      pageColor === "black"
        ? "rgba(248, 250, 252, 0.14)"
        : "rgba(30, 41, 59, 0.14)",
    horizontalLines,
    verticalLines,
    dotCenters,
  };
}

export function getNotebookSnapshotTypedText(
  textBlocks: readonly NotebookTextBlock[]
) {
  return [...textBlocks]
    .sort((left, right) => left.y - right.y || left.x - right.x)
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function wrapNotebookSnapshotText(
  text: string,
  maxWidth: number,
  measureText: (value: string) => number
) {
  const lines: string[] = [];
  const boundedWidth = Math.max(1, maxWidth);

  const pushLongWord = (word: string) => {
    let fragment = "";
    for (const character of word) {
      const candidate = `${fragment}${character}`;
      if (fragment && measureText(candidate) > boundedWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidate;
      }
    }
    return fragment;
  };

  for (const paragraph of text.replaceAll("\t", "    ").split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate) <= boundedWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current =
        measureText(word) <= boundedWidth ? word : pushLongWord(word);
    }
    if (current) lines.push(current);
  }

  return lines;
}

function makeRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const resolvedRadius = Math.max(
    0,
    Math.min(radius, width / 2, height / 2)
  );
  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.lineTo(x + width - resolvedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  context.lineTo(x + width, y + height - resolvedRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - resolvedRadius,
    y + height
  );
  context.lineTo(x + resolvedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  context.lineTo(x, y + resolvedRadius);
  context.quadraticCurveTo(x, y, x + resolvedRadius, y);
  context.closePath();
}

function drawPaper(
  context: CanvasRenderingContext2D,
  pageColor: NotebookPageColor,
  pageStyle: NotebookPageStyle
) {
  const pattern = getNotebookSnapshotPaperPattern(pageColor, pageStyle);
  context.fillStyle = pattern.backgroundColor;
  context.fillRect(
    0,
    0,
    NOTEBOOK_PAGE_COORDINATE_WIDTH,
    NOTEBOOK_PAGE_COORDINATE_HEIGHT
  );

  context.fillStyle = pattern.lineColor;
  for (const y of pattern.horizontalLines) {
    context.fillRect(0, y, NOTEBOOK_PAGE_COORDINATE_WIDTH, 1);
  }
  for (const x of pattern.verticalLines) {
    context.fillRect(x, 0, 1, NOTEBOOK_PAGE_COORDINATE_HEIGHT);
  }
  if (pattern.dotCenters.length > 0) {
    context.beginPath();
    for (const dot of pattern.dotCenters) {
      context.moveTo(dot.x + 1.35, dot.y);
      context.arc(dot.x, dot.y, 1.35, 0, Math.PI * 2);
    }
    context.fill();
  }
}

function drawContainedSource(
  context: CanvasRenderingContext2D,
  decoded: DecodedCanvasSource
) {
  const target = getNotebookSnapshotContainRect({
    containerWidth: NOTEBOOK_PAGE_COORDINATE_WIDTH,
    containerHeight: NOTEBOOK_PAGE_COORDINATE_HEIGHT,
    sourceWidth: decoded.width,
    sourceHeight: decoded.height,
  });
  context.drawImage(
    decoded.source,
    target.x,
    target.y,
    target.width,
    target.height
  );
}

function drawTextBlocks(
  context: CanvasRenderingContext2D,
  textBlocks: readonly NotebookTextBlock[],
  pageColor: NotebookPageColor
) {
  context.font = `600 ${NOTEBOOK_TEXT_FONT_SIZE}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textBaseline = "top";
  context.lineJoin = "round";

  for (const block of textBlocks) {
    if (block.width <= 0 || block.height <= 0) continue;
    context.save();
    makeRoundedRectPath(
      context,
      block.x,
      block.y,
      block.width,
      block.height,
      7
    );
    context.clip();

    if (block.outlineVisible) {
      context.strokeStyle =
        pageColor === "black"
          ? "rgba(255, 255, 255, 0.3)"
          : "rgba(15, 23, 42, 0.25)";
      context.lineWidth = 1;
      makeRoundedRectPath(
        context,
        block.x + 0.5,
        block.y + 0.5,
        Math.max(0, block.width - 1),
        Math.max(0, block.height - 1),
        7
      );
      context.stroke();
    }

    context.fillStyle = pageColor === "black" ? "#f8fafc" : "#0f172a";
    const lines = wrapNotebookSnapshotText(
      block.text,
      block.width - NOTEBOOK_TEXT_PADDING * 2,
      (value) => context.measureText(value).width
    );
    const maximumLines = Math.max(
      0,
      Math.floor(
        (block.height - NOTEBOOK_TEXT_PADDING * 2) / NOTEBOOK_TEXT_LINE_HEIGHT
      )
    );
    lines.slice(0, maximumLines).forEach((line, index) => {
      context.fillText(
        line,
        block.x + NOTEBOOK_TEXT_PADDING,
        block.y + NOTEBOOK_TEXT_PADDING + index * NOTEBOOK_TEXT_LINE_HEIGHT
      );
    });
    context.restore();
  }
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new NotebookPageSnapshotError(
      "canvas_unavailable",
      "This browser could not prepare the notebook page image."
    );
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<EncodedCanvas> {
  const webp = await canvasToBlob(
    canvas,
    "image/webp",
    NOTEBOOK_PAGE_SNAPSHOT_WEBP_QUALITY
  );
  if (webp?.type === "image/webp") {
    return { blob: webp, mimeType: "image/webp" };
  }

  const png = await canvasToBlob(canvas, "image/png");
  if (!png) {
    throw new NotebookPageSnapshotError(
      "canvas_unavailable",
      "This browser could not encode the notebook page image."
    );
  }
  return { blob: png, mimeType: "image/png" };
}

async function decodeBlob(blob: Blob): Promise<DecodedCanvasSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Older Safari releases can decode bitmap images but not SVG blobs.
    }
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new NotebookPageSnapshotError(
      "image_decode_failed",
      "This browser could not read part of the notebook page."
    );
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decode failed."));
      image.src = objectUrl;
    });
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("Image has no visible size.");
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new NotebookPageSnapshotError(
      "image_decode_failed",
      error instanceof Error
        ? `This browser could not read part of the notebook page: ${error.message}`
        : "This browser could not read part of the notebook page."
    );
  }
}

async function decodeBackground(
  background?: NotebookPageSnapshotBackground | null
): Promise<DecodedCanvasSource | null> {
  if (!background) return null;
  if (background.kind === "pdf-canvas") {
    if (background.canvas.width <= 0 || background.canvas.height <= 0) {
      throw new NotebookPageSnapshotError(
        "invalid_background",
        "The notebook page background is still loading."
      );
    }
    return {
      source: background.canvas,
      width: background.canvas.width,
      height: background.canvas.height,
      release: () => undefined,
    };
  }

  if (!background.mimeType.startsWith("image/") || background.bytes.byteLength === 0) {
    throw new NotebookPageSnapshotError(
      "invalid_background",
      "The notebook page image could not be read."
    );
  }
  const bytes = new Uint8Array(background.bytes.byteLength);
  bytes.set(background.bytes);
  return decodeBlob(new Blob([bytes.buffer], { type: background.mimeType }));
}

async function decodeInk(inkSvg: string) {
  const normalizedSvg = inkSvg.trim();
  if (!normalizedSvg) return null;
  return decodeBlob(
    new Blob([normalizedSvg], { type: "image/svg+xml;charset=utf-8" })
  );
}

function makeSnapshotCanvas(scale: number) {
  if (typeof document === "undefined") {
    throw new NotebookPageSnapshotError(
      "canvas_unavailable",
      "Notebook page snapshots are only available in the browser."
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(NOTEBOOK_PAGE_COORDINATE_WIDTH * scale);
  canvas.height = Math.round(NOTEBOOK_PAGE_COORDINATE_HEIGHT * scale);
  return canvas;
}

async function renderAtScale(input: {
  background: DecodedCanvasSource | null;
  ink: DecodedCanvasSource | null;
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
  scale: number;
  textBlocks: readonly NotebookTextBlock[];
}) {
  const canvas = makeSnapshotCanvas(input.scale);
  try {
    const context = getCanvasContext(canvas);
    context.setTransform(input.scale, 0, 0, input.scale, 0, 0);
    drawPaper(context, input.pageColor, input.pageStyle);
    if (input.background) {
      // PDF hosts are white in the editor even when the notebook page is black.
      if (input.background.source instanceof HTMLCanvasElement) {
        context.fillStyle = "#ffffff";
        context.fillRect(
          0,
          0,
          NOTEBOOK_PAGE_COORDINATE_WIDTH,
          NOTEBOOK_PAGE_COORDINATE_HEIGHT
        );
      }
      drawContainedSource(context, input.background);
    }
    if (input.ink) drawContainedSource(context, input.ink);
    drawTextBlocks(context, input.textBlocks, input.pageColor);
    const encoded = await encodeCanvas(canvas);
    return {
      ...encoded,
      height: canvas.height,
      width: canvas.width,
    };
  } finally {
    // Releasing backing storage promptly matters on memory-constrained iPads.
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function renderNotebookPageSnapshot(
  input: RenderNotebookPageSnapshotInput
): Promise<RenderedNotebookPageSnapshot> {
  const maxEncodedBytes =
    Number.isFinite(input.maxEncodedBytes) && (input.maxEncodedBytes ?? 0) > 0
      ? Math.max(1, Math.floor(input.maxEncodedBytes!))
      : NOTEBOOK_PAGE_SNAPSHOT_MAX_ENCODED_BYTES;
  const [background, ink] = await Promise.all([
    decodeBackground(input.background),
    decodeInk(input.inkSvg),
  ]);
  const typedText = getNotebookSnapshotTypedText(input.textBlocks);

  try {
    for (const scale of [
      NOTEBOOK_PAGE_SNAPSHOT_SCALE,
      NOTEBOOK_PAGE_SNAPSHOT_FALLBACK_SCALE,
    ]) {
      const rendered = await renderAtScale({
        background,
        ink,
        pageColor: input.pageColor,
        pageStyle: input.pageStyle,
        scale,
        textBlocks: input.textBlocks,
      });
      if (rendered.blob.size <= maxEncodedBytes) {
        return {
          ...rendered,
          encodedBytes: rendered.blob.size,
          scale,
          typedText,
        };
      }
    }
  } finally {
    background?.release();
    ink?.release();
  }

  throw new NotebookPageSnapshotError(
    "snapshot_too_large",
    "This notebook page is too detailed to send safely. Try asking again after simplifying the page background."
  );
}
