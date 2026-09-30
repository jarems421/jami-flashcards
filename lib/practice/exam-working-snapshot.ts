/**
 * Turning a student's ink into the single image a marker reads.
 *
 * Kept out of the sheet component because none of it is about the sheet on
 * screen: given the pages that were written on and the paper they sit over, it
 * answers with one PNG, and it is the only place that decides what does and
 * does not go into a student's stored evidence.
 */

import {
  EXAM_SHEET_A4_PAGE_HEIGHT,
  EXAM_SHEET_PAGE_WIDTH,
  examSheetPageCaption,
  type ExamSheetPage,
} from "@/lib/practice/exam-question-sheet";
import {
  examSheetPageGround,
  type ExamSheetPaper,
} from "@/lib/practice/exam-sheet-paper";
import {
  examWorkingSheetLayout,
  type ExamWorkingInkedPage,
} from "@/lib/practice/exam-working";

/**
 * The page a sheet falls back to when the question has no printed paper.
 *
 * A question Jami wrote has no crop to write on, so its sheet is blank pages
 * at the shape of the paper every board prints on.
 */
export const BLANK_PAGE: ExamSheetPage = {
  kind: "continuation",
  number: 1,
  width: EXAM_SHEET_PAGE_WIDTH,
  height: EXAM_SHEET_A4_PAGE_HEIGHT,
};
/** The band between pages in the submitted image, in the sheet's own units. */
const SNAPSHOT_PAGE_GAP = 28;
/** The strip above each page in that image, which says what the page is. */
const SNAPSHOT_CAPTION_HEIGHT = 48;
const SNAPSHOT_CAPTION_FONT = 26;

export function loadSvgImage(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  image.src = url;
  return image
    .decode()
    .then(() => image)
    .finally(() => URL.revokeObjectURL(url));
}

/**
 * Every inked page, laid into the one image the marker reads.
 *
 * A marker reads ink on paper, so the pages are flattened onto white rather
 * than sent as transparent overlays whose ground it would have to guess.
 *
 * What is not flattened in is the paper. A student now writes on the board's
 * own page, and burning that page into the submission would put licensed
 * question material inside a student's own stored evidence, and hand the
 * marker one image in which the printing and the handwriting are the same
 * kind of mark. The question is already sent separately, and labelled as
 * question material; this stays the student's side of it.
 *
 * So each page is captioned instead. "Written on printed page 2 of 3" says
 * where on the paper the ink was, which is the part flattening was for, and
 * says it in a form no one can mistake for the student's own writing.
 */
export async function pagesToPng(
  inked: readonly ExamWorkingInkedPage[],
  sheet: readonly ExamSheetPage[],
  questionLabel: string,
  paper: ExamSheetPaper
) {
  if (inked.length === 0) return undefined;
  try {
    const printedPageCount = sheet.filter((page) => page.kind === "printed").length;
    const entries = inked.map((entry) => {
      const page = sheet[entry.index] ?? BLANK_PAGE;
      return {
        svg: entry.svg,
        width: page.width,
        height: page.height,
        caption: examSheetPageCaption({ page, questionLabel, printedPageCount }),
        /*
         * Its own ground, not white. A light pen on a dark sheet is an
         * ordinary thing to write, and flattening it onto white would submit a
         * blank page as the student's answer.
         */
        ground: examSheetPageGround(page, paper),
      };
    });
    const layout = examWorkingSheetLayout({
      pages: entries,
      gap: SNAPSHOT_PAGE_GAP,
      captionHeight: SNAPSHOT_CAPTION_HEIGHT,
    });
    const images = await Promise.all(entries.map((entry) => loadSvgImage(entry.svg)));
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#e5e7eb";
    context.fillRect(0, 0, layout.width, layout.height);
    context.textBaseline = "middle";
    context.font = `600 ${Math.round(SNAPSHOT_CAPTION_FONT * layout.scale)}px ui-sans-serif, system-ui, sans-serif`;
    images.forEach((image, index) => {
      const slot = layout.slots[index];
      if (!slot) return;
      context.fillStyle = "#334155";
      context.fillText(
        entries[index].caption,
        slot.left,
        slot.captionTop + slot.captionHeight / 2
      );
      context.fillStyle = entries[index].ground;
      context.fillRect(slot.left, slot.top, slot.width, slot.height);
      context.drawImage(image, slot.left, slot.top, slot.width, slot.height);
    });
    return {
      mimeType: "image/png" as const,
      dataBase64: canvas.toDataURL("image/png").split(",")[1],
      width: layout.width,
      height: layout.height,
    };
  } catch {
    // Failure blocks submission; never silently mark the typed answer alone.
    return undefined;
  }
}

