import {
  MAX_NOTEBOOK_MARKDOWN_BLOCK_TEXT,
  MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  type NotebookImageRef,
  type NotebookTextBlock,
} from "@/lib/workspace/notebooks";
import type { NotebookGraphBlock } from "@/lib/workspace/notebook-graphs";
import {
  NOTEBOOK_ANSWER_FONT_SIZE,
  NOTEBOOK_ANSWER_LINE_HEIGHT,
  NOTEBOOK_TEXT_PADDING,
} from "@/lib/workspace/notebook-text-metrics";

/**
 * A Tutor answer, placed on a notebook page as a box of its own.
 *
 * Copying an answer into a text box kept its words and lost everything else:
 * the table became rows of pipes, the maths became dollar signs and
 * backslashes. The box made here keeps the answer's own Markdown and shows it
 * the way the Tutor did, so nothing has to be turned into a picture -- which
 * would have cost an image model call for every answer -- to look right.
 */

/** Room kept at the page's edges, and between the answer and what is above it. */
const PAGE_MARGIN = 60;
const GAP_ABOVE = 24;
/** Wide enough for a table, with the margin a page of notes would have. */
const ANSWER_WIDTH = NOTEBOOK_PAGE_COORDINATE_WIDTH - PAGE_MARGIN * 2;

/**
 * Roughly how tall an answer will be once it is typeset, in page units.
 *
 * Only for choosing where it goes. The box itself starts short and grows to
 * whatever the answer really measures on the page.
 */
export function estimateNotebookAnswerHeight(text: string, width = ANSWER_WIDTH) {
  // An average character of the page's type is a little over half its size.
  const charactersPerLine = Math.max(
    12,
    Math.floor((width - NOTEBOOK_TEXT_PADDING * 2) / (NOTEBOOK_ANSWER_FONT_SIZE * 0.52))
  );
  let lines = 0;
  let inDisplayMaths = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "$$" || line === "\\[" || line === "\\]") {
      inDisplayMaths = line === "$$" ? !inDisplayMaths : line === "\\[";
      lines += 0.5;
      continue;
    }
    if (inDisplayMaths) {
      lines += 1.6;
    } else if (!line) {
      lines += 0.5;
    } else if (/^\|?\s*:?-{3,}/.test(line)) {
      // A table's divider row draws no text.
    } else if (line.startsWith("|")) {
      lines += 1.6;
    } else if (/^#{1,6}\s/.test(line)) {
      lines += 1.8;
    } else {
      lines += Math.ceil(line.length / charactersPerLine);
    }
  }
  return Math.ceil(lines * NOTEBOOK_ANSWER_LINE_HEIGHT + NOTEBOOK_TEXT_PADDING * 2);
}

type PlacedItems = {
  textBlocks: readonly Pick<NotebookTextBlock, "y" | "height">[];
  imageRefs?: readonly Pick<NotebookImageRef, "y" | "displayHeight">[];
  graphBlocks?: readonly Pick<NotebookGraphBlock, "y" | "height">[];
};

/** The foot of the lowest thing placed on the page, or null on an empty one. */
function lowestPlacedEdge({ textBlocks, imageRefs = [], graphBlocks = [] }: PlacedItems) {
  const edges = [
    ...textBlocks.map((block) => block.y + block.height),
    ...imageRefs
      .filter((image) => typeof image.y === "number" && typeof image.displayHeight === "number")
      .map((image) => image.y! + image.displayHeight!),
    ...graphBlocks.map((graph) => graph.y + graph.height),
  ];
  return edges.length > 0 ? Math.max(...edges) : null;
}

export type NotebookAnswerBlockResult =
  | { ok: true; block: NotebookTextBlock }
  | { ok: false; message: string };

/**
 * The box a Tutor answer lands in: under whatever is already on the page when
 * it fits there, and otherwise at the top, where the student can move it.
 */
export function createNotebookAnswerBlock(input: {
  id: string;
  text: string;
  page: PlacedItems;
}): NotebookAnswerBlockResult {
  const text = input.text.trim();
  if (!text) return { ok: false, message: "That answer has nothing in it to add." };
  if (text.length > MAX_NOTEBOOK_MARKDOWN_BLOCK_TEXT) {
    return {
      ok: false,
      message: "That answer is too long for one page. Ask Tutor for a shorter version to add.",
    };
  }

  const estimate = estimateNotebookAnswerHeight(text);
  const lowest = lowestPlacedEdge(input.page);
  const below = lowest === null ? PAGE_MARGIN : lowest + GAP_ABOVE;
  const fitsBelow = below + estimate <= NOTEBOOK_PAGE_COORDINATE_HEIGHT - PAGE_MARGIN / 2;
  const y = fitsBelow ? below : PAGE_MARGIN;

  return {
    ok: true,
    block: {
      id: input.id,
      x: PAGE_MARGIN,
      y,
      width: ANSWER_WIDTH,
      // Short to begin with: it grows to the answer's real height once shown.
      height: Math.max(
        MIN_NOTEBOOK_TEXT_BLOCK_HEIGHT,
        Math.min(96, NOTEBOOK_PAGE_COORDINATE_HEIGHT - y)
      ),
      text,
      // Unframed, so it reads as part of the page rather than a pasted card.
      outlineVisible: false,
      format: "markdown",
    },
  };
}
