"use client";

/** Long edge of the picture, in pixels: sharp at the 520 units a page draws it. */
const OUTPUT_LONG_EDGE = 1600;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * The markup with the SVG namespace declared on its root.
 *
 * Figures are written for inline HTML, where the namespace is implied, so they
 * usually omit it. Parsed as XML without it, every element lands in no
 * namespace at all, and declaring it on the root afterwards is too late: the
 * serialiser then marks each child `xmlns=""` to keep it where it was, and the
 * image draws as nothing. It has to be there before the markup is parsed.
 */
function withSvgNamespace(svg: string) {
  return /<svg\b[^>]*\sxmlns\s*=/i.test(svg)
    ? svg
    : svg.replace(/<svg\b/i, `<svg xmlns="${SVG_NAMESPACE}"`);
}

function readViewBox(root: Element) {
  const parts = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [, , width, height] = parts;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * A figure the Tutor drew, as a PNG a notebook page can hold.
 *
 * Pages hold pictures, not markup, and the page-image path already takes a PNG
 * -- so the figure is drawn once here rather than taught to the page. The input
 * is the sanitiser's output, never the model's: nothing in it can reach out to
 * the network, which is also what keeps the canvas readable afterwards.
 *
 * Drawn on white. A figure written for the chat's light panel with no
 * background of its own would otherwise land as black lines on a dark page.
 */
export async function drawnFigureToPng(svg: string): Promise<File> {
  const doc = new DOMParser().parseFromString(withSvgNamespace(svg), "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("That figure could not be read.");
  }
  const box = readViewBox(root);
  if (!box) throw new Error("That figure has no size to draw it at.");

  const scale = OUTPUT_LONG_EDGE / Math.max(box.width, box.height);
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));

  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    new XMLSerializer().serializeToString(root)
  )}`;
  await image.decode().catch(() => {
    throw new Error("That figure could not be drawn.");
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("That figure could not be drawn.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("That figure could not be drawn.");
  return new File([blob], "Jami figure.png", { type: "image/png" });
}
