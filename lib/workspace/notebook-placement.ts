import {
  MIN_NOTEBOOK_IMAGE_DISPLAY_SIZE,
  MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT,
  MIN_NOTEBOOK_TEXT_BLOCK_WIDTH,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  isNotebookResizeEdge,
  normalizeNotebookImageRefs,
  type NotebookImageRef,
  type NotebookResizeHandle,
  type NotebookTextBlock,
  type NotebookTextBlockResizeEdge,
} from "@/lib/workspace/notebooks";

/*
 * Placing, moving and resizing what sits on a notebook page: images and text
 * boxes. Every result is kept on the page, in the page's own coordinates.
 */

/** An image re-read after an edit; the edit keeps its id, so it always comes back. */
function placeImage(images: readonly Record<string, unknown>[]): NotebookImageRef {
  const [placed] = normalizeNotebookImageRefs(images);
  if (!placed) throw new Error("An image lost its id while being placed.");
  return placed;
}

export function createCenteredNotebookImageRef(input: {
  id: string;
  storagePath: string;
  width: number;
  height: number;
  altText?: string;
  sourceAssetId?: string;
}) {
  const aspectRatio = input.width > 0 && input.height > 0 ? input.width / input.height : 4 / 3;
  const displayWidth = 520;
  const displayHeight = Math.max(
    MIN_NOTEBOOK_IMAGE_DISPLAY_SIZE,
    Math.min(620, Math.round(displayWidth / aspectRatio))
  );
  return placeImage([
    {
      ...input,
      x: Math.round((NOTEBOOK_PAGE_COORDINATE_WIDTH - displayWidth) / 2),
      y: Math.round((NOTEBOOK_PAGE_COORDINATE_HEIGHT - displayHeight) / 2),
      displayWidth,
      displayHeight,
    },
  ]);
}

function notebookImagePlacement(image: NotebookImageRef) {
  return {
    x: image.x ?? 0,
    y: image.y ?? 0,
    displayWidth: image.displayWidth ?? 480,
    displayHeight: image.displayHeight ?? 360,
  };
}

export function moveNotebookImageRef(
  image: NotebookImageRef,
  deltaX: number,
  deltaY: number
) {
  const placement = notebookImagePlacement(image);
  return placeImage([
    {
      ...image,
      x: placement.x + deltaX,
      y: placement.y + deltaY,
      displayWidth: placement.displayWidth,
      displayHeight: placement.displayHeight,
    },
  ]);
}

/**
 * Resize an image by dragging one corner, keeping the opposite corner pinned.
 *
 * The aspect ratio is locked, so a drag on any corner reads as one gesture:
 * whichever axis the pointer commits to further wins, and the other follows.
 * Dragging the top or left side therefore moves the origin as the box grows,
 * which is what makes a top-left grip pull the image outwards rather than
 * shrinking it from the far edge.
 */
export function resizeNotebookImageRef(
  image: NotebookImageRef,
  deltaX: number,
  deltaY: number,
  corner: NotebookResizeHandle = "bottom-right"
) {
  if (isNotebookResizeEdge(corner)) {
    return resizeNotebookImageRefFromEdge(image, deltaX, deltaY, corner);
  }
  const placement = notebookImagePlacement(image);
  const aspectRatio = placement.displayWidth / placement.displayHeight;
  const growsRight = corner === "top-right" || corner === "bottom-right";
  const growsDown = corner === "bottom-left" || corner === "bottom-right";
  const anchorX = growsRight
    ? placement.x
    : placement.x + placement.displayWidth;
  const anchorY = growsDown
    ? placement.y
    : placement.y + placement.displayHeight;

  // Pointer movement towards the anchored corner shrinks the image, so the
  // grips on the left and top read their axis in reverse.
  const widthIntent = growsRight ? deltaX : -deltaX;
  const heightIntent = growsDown ? deltaY : -deltaY;
  const scaledHeightIntent = heightIntent * aspectRatio;
  const resizeIntent = Math.abs(widthIntent) >= Math.abs(scaledHeightIntent)
    ? widthIntent
    : scaledHeightIntent;
  const requestedWidth = placement.displayWidth + resizeIntent;

  // Room left on the page, measured outwards from the anchored corner and
  // expressed as a width so a single clamp covers both axes.
  const roomForWidth = growsRight
    ? NOTEBOOK_PAGE_COORDINATE_WIDTH - anchorX
    : anchorX;
  const roomForHeight = growsDown
    ? NOTEBOOK_PAGE_COORDINATE_HEIGHT - anchorY
    : anchorY;
  const minWidth = Math.max(
    MIN_NOTEBOOK_IMAGE_DISPLAY_SIZE,
    MIN_NOTEBOOK_IMAGE_DISPLAY_SIZE * aspectRatio
  );
  const maxWidth = Math.max(
    minWidth,
    Math.min(roomForWidth, roomForHeight * aspectRatio)
  );

  const displayWidth = Math.min(Math.max(requestedWidth, minWidth), maxWidth);
  const displayHeight = displayWidth / aspectRatio;
  return placeImage([
    {
      ...image,
      x: growsRight ? anchorX : anchorX - displayWidth,
      y: growsDown ? anchorY : anchorY - displayHeight,
      displayWidth,
      displayHeight,
    },
  ]);
}

/**
 * Resize an image by pulling one side, keeping the opposite side pinned.
 *
 * The shape stays locked, so the other axis grows with it -- evenly about its
 * centre, which is where a side handle sits. Only the pull across the side
 * counts: sliding along it does nothing, as on any other editor's side grip.
 */
function resizeNotebookImageRefFromEdge(
  image: NotebookImageRef,
  deltaX: number,
  deltaY: number,
  edge: NotebookTextBlockResizeEdge
) {
  const placement = notebookImagePlacement(image);
  const aspectRatio = placement.displayWidth / placement.displayHeight;
  const horizontal = edge === "left" || edge === "right";
  const centreX = placement.x + placement.displayWidth / 2;
  const centreY = placement.y + placement.displayHeight / 2;
  const minWidth = Math.max(
    MIN_NOTEBOOK_IMAGE_DISPLAY_SIZE,
    MIN_NOTEBOOK_IMAGE_DISPLAY_SIZE * aspectRatio
  );

  let requestedWidth: number;
  let maxWidth: number;
  if (horizontal) {
    const growsRight = edge === "right";
    const anchorX = growsRight ? placement.x : placement.x + placement.displayWidth;
    requestedWidth = placement.displayWidth + (growsRight ? deltaX : -deltaX);
    const roomForWidth = growsRight ? NOTEBOOK_PAGE_COORDINATE_WIDTH - anchorX : anchorX;
    // Centred vertically, so the height may only grow as far as the nearer page edge allows twice over.
    const roomForHeight = 2 * Math.min(centreY, NOTEBOOK_PAGE_COORDINATE_HEIGHT - centreY);
    maxWidth = Math.max(minWidth, Math.min(roomForWidth, roomForHeight * aspectRatio));
    const displayWidth = Math.min(Math.max(requestedWidth, minWidth), maxWidth);
    const displayHeight = displayWidth / aspectRatio;
    return placeImage([
      {
        ...image,
        x: growsRight ? anchorX : anchorX - displayWidth,
        y: centreY - displayHeight / 2,
        displayWidth,
        displayHeight,
      },
    ]);
  }

  const growsDown = edge === "bottom";
  const anchorY = growsDown ? placement.y : placement.y + placement.displayHeight;
  requestedWidth = (placement.displayHeight + (growsDown ? deltaY : -deltaY)) * aspectRatio;
  const roomForHeight = growsDown ? NOTEBOOK_PAGE_COORDINATE_HEIGHT - anchorY : anchorY;
  const roomForWidth = 2 * Math.min(centreX, NOTEBOOK_PAGE_COORDINATE_WIDTH - centreX);
  maxWidth = Math.max(minWidth, Math.min(roomForWidth, roomForHeight * aspectRatio));
  const displayWidth = Math.min(Math.max(requestedWidth, minWidth), maxWidth);
  const displayHeight = displayWidth / aspectRatio;
  return placeImage([
    {
      ...image,
      x: centreX - displayWidth / 2,
      y: growsDown ? anchorY : anchorY - displayHeight,
      displayWidth,
      displayHeight,
    },
  ]);
}

export function resizeNotebookTextBlockFromEdge(input: {
  block: NotebookTextBlock;
  edge: NotebookTextBlockResizeEdge;
  deltaX: number;
  deltaY: number;
  /**
   * The shortest the box may get: the height of the text in it. A box grows
   * to hold its text, so shrinking it past that moves nothing -- and from the
   * top edge it would slide the box down instead of shrinking it.
   */
  minHeight?: number;
}): NotebookTextBlock {
  const roundedDeltaX = Math.round(input.deltaX);
  const roundedDeltaY = Math.round(input.deltaY);
  const minHeight = Math.max(
    MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT,
    Math.ceil(input.minHeight ?? 0)
  );
  const right = input.block.x + input.block.width;
  const bottom = input.block.y + input.block.height;
  const next: NotebookTextBlock = { ...input.block };

  if (input.edge === "left") {
    const x = Math.max(
      0,
      Math.min(right - MIN_NOTEBOOK_TEXT_BLOCK_WIDTH, input.block.x + roundedDeltaX)
    );
    next.x = x;
    next.width = right - x;
  }

  if (input.edge === "right") {
    next.width = Math.max(
      MIN_NOTEBOOK_TEXT_BLOCK_WIDTH,
      Math.min(NOTEBOOK_PAGE_COORDINATE_WIDTH - input.block.x, input.block.width + roundedDeltaX)
    );
  }

  if (input.edge === "top") {
    const y = Math.max(
      0,
      Math.min(bottom - minHeight, input.block.y + roundedDeltaY)
    );
    next.y = y;
    next.height = bottom - y;
  }

  if (input.edge === "bottom") {
    next.height = Math.max(
      minHeight,
      Math.min(NOTEBOOK_PAGE_COORDINATE_HEIGHT - input.block.y, input.block.height + roundedDeltaY)
    );
  }

  return next;
}
