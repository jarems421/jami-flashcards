"use client";

import { memo } from "react";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";
import type { ExamSheetPage } from "@/lib/practice/exam-question-sheet";
import { EXAM_SHEET_PAPER_DEFAULT, type ExamSheetPaper } from "@/lib/practice/exam-sheet-paper";
import { getNotebookPageStyleBackground } from "@/lib/workspace/notebook-page-content";
import { getNotebookPaperPalette } from "@/lib/workspace/notebook-paper-palette";

/**
 * What a student writes on: the board's own page, or paper of their choosing.
 *
 * A printed page is the paper itself, streamed through the authorised route
 * and stretched onto a box the sheet has already shaped from the asset's own
 * dimensions -- so the ink layer above it lands exactly where the print is.
 * Nothing is cropped, letterboxed or rounded here: a page of a question paper
 * has square corners and content that runs to its edges, and clipping those
 * corners is what made the paper look smudged away at the top. It takes no
 * colour and no ruling of the student's, because it is not theirs to change.
 *
 * A continuation page is. The blank answer pages a paper leaves are counted at
 * ingestion and never rendered, so this draws its own paper -- the notebook's
 * own rulings and papers, so the two surfaces are made of the same stuff.
 */
function ExamSheetPageBackground({
  page,
  assetPath,
  questionLabel,
  paper = EXAM_SHEET_PAPER_DEFAULT,
}: {
  page: ExamSheetPage;
  /** Where a printed page's image is fetched from, given its asset id. */
  assetPath(assetId: string): string;
  questionLabel: string;
  paper?: ExamSheetPaper;
}) {
  if (page.kind === "printed") {
    return (
      <ExamPrivateImage
        cache
        fill
        alt={`Page ${page.number} of the question paper for ${questionLabel}`}
        path={assetPath(page.assetId)}
        width={page.width}
        height={page.height}
      />
    );
  }

  /*
   * The ruling stretches to the page rather than tiling it, which is what lets
   * one sheet of paper serve pages of different heights without the spacing
   * changing from page to page by a whole line.
   */
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundColor: getNotebookPaperPalette(paper.pageColor).paper,
        ...getNotebookPageStyleBackground(paper.pageColor, paper.pageStyle),
      }}
    />
  );
}

export default memo(ExamSheetPageBackground);
