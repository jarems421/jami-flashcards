"use client";

import { useState } from "react";
import { examSheetPrintedPages } from "@/lib/practice/exam-question-sheet";
import type { ExamSessionQuestion } from "@/lib/practice/exam-questions";

/**
 * The question's pages of paper, the same array for as long as it is the same
 * question.
 *
 * The session is re-read every few seconds while an answer is being marked, and
 * every read builds fresh objects all the way down -- so a plain `useMemo` on
 * `question` hands back a new array on each poll even though nothing about the
 * paper has changed. The sheet reads that as its pages having been replaced:
 * it reloads, turns back to page one, and remounts the ink editor under a hand
 * that is in the middle of a word.
 *
 * Keyed on what actually decides the pages. A re-ingest changes the content
 * version, and that is the one case where the paper really is different.
 */
export function useExamPrintedPages(question: ExamSessionQuestion | undefined) {
  const signature = question ? `${question.id}:${question.contentVersion}` : "";
  const read = () => ({
    signature,
    pages: question ? examSheetPrintedPages(question) : [],
  });
  const [cached, setCached] = useState(read);
  // React's own way of adjusting state when a prop changes: the re-render
  // happens before anything is committed, so no effect sees the stale array.
  if (cached.signature !== signature) setCached(read);
  return cached.pages;
}
