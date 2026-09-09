"use client";

import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";
import PracticePaperAssets from "@/components/practice/PracticePaperAssets";

export default function ExamQuestionAssets({
  sessionId,
  questionId,
  assets,
}: {
  sessionId: string;
  questionId: string;
  assets: PracticePaperQuestionAsset[];
}) {
  const images = assets.filter((asset) => asset.type === "image" || asset.type === "illustration");
  const structured = assets.filter((asset) => asset.type !== "image" && asset.type !== "illustration");
  return (
    <>
      {structured.length ? <PracticePaperAssets assets={structured} /> : null}
      {images.map((asset) => (
        <ExamPrivateImage
          key={`${questionId}:${asset.id}`}
          alt={asset.altText}
          className="mt-3 max-h-[34rem]"
          path={`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(questionId)}/${encodeURIComponent(asset.id)}`}
        />
      ))}
    </>
  );
}
