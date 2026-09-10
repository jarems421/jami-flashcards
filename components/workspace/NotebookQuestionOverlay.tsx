"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import PracticePaperAssets from "@/components/practice/PracticePaperAssets";
import type { NotebookPage } from "@/lib/workspace/notebooks";

/**
 * The question a page was written against, floated above the sheet.
 *
 * A page saved out of Past Paper Practice records the session it came from and
 * used to offer no way back to it, so the loop the feature is built around --
 * notebook to practice to notebook -- ended in a dead end on the last step.
 */
export default function NotebookQuestionOverlay({
  page,
  dockedTop,
}: {
  page: NotebookPage;
  dockedTop: boolean;
}) {
  if (!page.questionPrompt) return null;
  return (
    <div
      className={`absolute left-1/2 z-20 w-[min(92vw,36rem)] -translate-x-1/2 ${
        dockedTop ? "top-[5rem]" : "top-3"
      }`}
    >
      <Card tone="warm" padding="sm">
        <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">
          {page.questionPrompt}
        </p>
        <PracticePaperAssets assets={page.questionAssets ?? []} />
        {page.linkedExamSessionId ? (
          <Link
            href={`/dashboard/practice/questions/${encodeURIComponent(page.linkedExamSessionId)}`}
            className="mt-2 inline-block text-xs font-medium text-accent underline-offset-2 hover:underline"
          >
            Open original practice
          </Link>
        ) : null}
      </Card>
    </div>
  );
}
