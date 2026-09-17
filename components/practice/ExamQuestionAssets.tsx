"use client";

import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";
import PracticePaperAssets from "@/components/practice/PracticePaperAssets";
import { EXAM_PRINTED_QUESTION_ASSET_ID } from "@/lib/practice/exam-question-display";
import { examSheetPageAssetNumber } from "@/lib/practice/exam-question-sheet";

/**
 * A question's figures, at a size a student can actually read.
 *
 * A cropped page of a real paper can be a graph with gridlines, a circuit, or
 * a table of data, and it was rendered once at column width with no way to
 * look closer. On a phone that made some questions unanswerable rather than
 * merely awkward -- the answer is in the figure, and the figure is 340px wide.
 *
 * Enlarging uses the shared dialog, which brings focus handling, Escape and
 * background isolation with it. Zoom is a scale on the image inside a
 * scrolling frame, so the aspect ratio is never touched and nothing is
 * cropped: at any zoom the whole figure is still reachable by scrolling.
 */
const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

export default function ExamQuestionAssets({
  sessionId,
  questionId,
  assets,
}: {
  sessionId: string;
  questionId: string;
  assets: PracticePaperQuestionAsset[];
}) {
  const [enlarged, setEnlarged] = useState<PracticePaperQuestionAsset | null>(null);
  const [zoom, setZoom] = useState(0);

  /*
   * The stitched question, never the pages it was cut into.
   *
   * Ingestion stores a question's paper twice: once as one image, and again as
   * one image per page for the sheet a student writes on. Both are images and
   * both are servable, so a plain type filter drew the question and then drew
   * every page of it again underneath.
   */
  const images = assets.filter(
    (asset) =>
      (asset.type === "image" || asset.type === "illustration") &&
      examSheetPageAssetNumber(asset.id) === null
  );
  const structured = assets.filter((asset) => asset.type !== "image" && asset.type !== "illustration");
  const pathFor = (asset: PracticePaperQuestionAsset) =>
    `/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(questionId)}/${encodeURIComponent(asset.id)}`;

  const close = () => {
    setEnlarged(null);
    setZoom(0);
  };

  return (
    <>
      {structured.length ? <PracticePaperAssets assets={structured} /> : null}
      {/*
        * Each image sits on its own white sheet, as it was printed, with the
        * enlarge control in its corner rather than a line of its own under it.
        * The printed question is the question, so it is never height-capped.
        */}
      {images.map((asset) => {
        const printed = asset.id === EXAM_PRINTED_QUESTION_ASSET_ID;
        const label = printed
          ? "Enlarge question"
          : `Enlarge ${asset.title ? asset.title.toLowerCase() : "figure"}`;
        const open = () => {
          setEnlarged(asset);
          setZoom(0);
        };
        return (
          /*
            * The page itself opens it.
            *
            * The only way in used to be a small button in the corner that
            * appeared on hover -- so on a touch screen, which is where a
            * cramped figure is least readable, it was invisible until it was
            * pressed by accident. The whole figure is the control now, the
            * button beside it is a visible affordance rather than the
            * mechanism, and neither of them is hidden.
            *
            * Padded rather than clipped. A rounded box with the page flush
            * inside it cut the corners off the paper, which read as the
            * question being smudged away at its edges.
            */
          <figure
            key={`${questionId}:${asset.id}`}
            className="mt-4 rounded-xl border border-[var(--color-border)] bg-white p-1.5"
          >
            <button
              type="button"
              aria-label={label}
              onClick={open}
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <ExamPrivateImage
                alt={asset.altText}
                width={asset.width}
                height={asset.height}
                imageClassName={printed ? "" : "max-h-[34rem]"}
                path={pathFor(asset)}
              />
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-text-secondary shadow-e1 backdrop-blur transition-colors group-hover:text-text-primary"
              >
                <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
                  <path
                    d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </figure>
        );
      })}

      <Dialog
        open={Boolean(enlarged)}
        onDismiss={close}
        className="fixed inset-0 z-50 flex flex-col bg-[var(--app-background)] p-3"
      >
        {enlarged ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <h2 className="text-sm font-semibold text-text-primary">
                {enlarged.title || "Question figure"}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Zoom out"
                  disabled={zoom === 0}
                  onClick={() => setZoom((step) => Math.max(0, step - 1))}
                >
                  −
                </Button>
                <span className="text-xs tabular-nums text-text-muted" aria-live="polite">
                  {ZOOM_STEPS[zoom]}×
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Zoom in"
                  disabled={zoom === ZOOM_STEPS.length - 1}
                  onClick={() => setZoom((step) => Math.min(ZOOM_STEPS.length - 1, step + 1))}
                >
                  +
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={close}>
                  Done
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-white">
              <div style={{ width: `${ZOOM_STEPS[zoom] * 100}%` }}>
                <ExamPrivateImage
                  key={`enlarged:${enlarged.id}`}
                  alt={enlarged.altText}
                  width={enlarged.width}
                  height={enlarged.height}
                  path={pathFor(enlarged)}
                />
              </div>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
