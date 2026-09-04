/**
 * Putting a picture on a page, as opposed to putting one in a notebook.
 *
 * Uploading a file already existed and means something else entirely: a PDF or
 * a photo becomes its own immutable page, which is right for a past paper and
 * wrong for a graph you want to write around. This is the other thing -- an
 * image placed on the page you are already working on, which moves and resizes
 * like the illustrations Jami inserts, because it is exactly the same record.
 *
 * PDFs are deliberately not accepted here. A PDF is a document, and the app
 * already has the better answer for one.
 */

export const NOTEBOOK_PAGE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/**
 * Under the 20 MB the Storage rules enforce, with room to spare. A page image
 * is rendered at most 900 coordinate units wide, so anything near the ceiling
 * is a photo that has not been resized rather than detail anyone will see.
 */
export const MAX_NOTEBOOK_PAGE_IMAGE_BYTES = 12 * 1024 * 1024;

export function validateNotebookPageImage(file: {
  type: string;
  size: number;
}) {
  if (
    !NOTEBOOK_PAGE_IMAGE_TYPES.includes(
      file.type as (typeof NOTEBOOK_PAGE_IMAGE_TYPES)[number]
    )
  ) {
    throw new Error("Add a JPEG, PNG, or WebP image.");
  }
  if (file.size <= 0) {
    throw new Error("That image file is empty.");
  }
  if (file.size > MAX_NOTEBOOK_PAGE_IMAGE_BYTES) {
    throw new Error("Images on a page must be under 12 MB.");
  }
}

/**
 * How big to draw it, in page coordinates.
 *
 * Wide enough to be worth adding and short enough to leave room to write under
 * it. A very tall image is bounded by height instead, so a portrait photo does
 * not arrive taller than the page it is being placed on.
 */
export function getNotebookPageImageDisplaySize(input: {
  width: number;
  height: number;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const maxWidth = input.maxWidth ?? 520;
  const maxHeight = input.maxHeight ?? 620;
  const aspectRatio =
    input.width > 0 && input.height > 0 ? input.width / input.height : 4 / 3;

  let displayWidth = maxWidth;
  let displayHeight = Math.round(displayWidth / aspectRatio);
  if (displayHeight > maxHeight) {
    displayHeight = maxHeight;
    displayWidth = Math.round(displayHeight * aspectRatio);
  }
  return {
    width: Math.max(1, displayWidth),
    height: Math.max(1, displayHeight),
  };
}
