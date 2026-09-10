"use client";

import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";
import PracticePaperAssets from "@/components/practice/PracticePaperAssets";

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

  const images = assets.filter((asset) => asset.type === "image" || asset.type === "illustration");
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
      {images.map((asset) => (
        <figure key={`${questionId}:${asset.id}`} className="mt-3">
          <ExamPrivateImage
            alt={asset.altText}
            className="max-h-[34rem]"
            path={pathFor(asset)}
          />
          <figcaption className="mt-1.5 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setEnlarged(asset);
                setZoom(0);
              }}
            >
              Enlarge{asset.title ? ` ${asset.title.toLowerCase()}` : " figure"}
            </Button>
          </figcaption>
        </figure>
      ))}

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
                  imageClassName="rounded-none"
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
