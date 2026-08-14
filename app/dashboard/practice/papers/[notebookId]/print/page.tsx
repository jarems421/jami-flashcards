"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { useUser } from "@/components/providers/UserProvider";
import { Button, Card, Skeleton, StudyText } from "@/components/ui";
import type { PracticePaper } from "@/lib/practice/practice-papers";
import { getPracticePaperByNotebookId } from "@/services/study/practice-papers";
import { getStorageFileDownloadUrl } from "@/services/firebase/storage-files";

function buildTextExport(paper: PracticePaper, includeReport: boolean) {
  const lines = [
    paper.title,
    `${paper.totalMarks} marks${paper.durationMinutes ? ` · ${paper.durationMinutes} minutes` : ""}`,
    "",
    ...paper.instructions,
    "",
  ];
  paper.questions.forEach((question) => {
    lines.push(`${question.label} [${question.marks} marks]`, question.prompt);
    question.assets.forEach((asset) =>
      lines.push("", asset.title, asset.content || asset.caption || asset.altText)
    );
    lines.push("", "");
  });
  if (includeReport && paper.result) {
    lines.push("MARKING REPORT", `${paper.result.awardedMarks}/${paper.result.totalMarks} (${paper.result.percentage}%)`, paper.result.summary, "");
    paper.result.questionResults.forEach((result) => {
      lines.push(`${result.label}: ${result.awardedMarks}/${result.maxMarks}${result.counted ? "" : " (not counted)"}`, result.feedback, "");
    });
  }
  return lines.join("\n");
}

function assetKey(questionId: string, assetId: string) {
  return `${questionId}:${assetId}`;
}

function PracticePaperPrintContent() {
  const { user } = useUser();
  const params = useParams<{ notebookId: string }>();
  const notebookId = typeof params.notebookId === "string" ? params.notebookId : "";
  const [paper, setPaper] = useState<PracticePaper | null>(null);
  const [loading, setLoading] = useState(true);
  /*
   * Asset readiness belongs to one paper, so the paper it was loaded for is
   * part of the value. A different paper invalidates it during render, which
   * is what stops a stale "ready to print" from surviving the swap without an
   * effect that resets three separate pieces of state before any load starts.
   */
  const [assetState, setAssetState] = useState<{
    paperId: string;
    urls: Record<string, string>;
    settled: boolean;
    error: string;
  }>({ paperId: "", urls: {}, settled: false, error: "" });
  const searchParams = useSearchParams();
  const includeReport = searchParams.get("report") === "1";

  useEffect(() => {
    void getPracticePaperByNotebookId(user.uid, notebookId)
      .then(setPaper)
      .finally(() => setLoading(false));
  }, [notebookId, user.uid]);

  useEffect(() => {
    if (!paper) return;
    let active = true;
    const paperId = paper.id;
    const assets = paper.questions.flatMap((question) =>
      question.assets
        .filter((asset) => asset.storagePath)
        .map((asset) => ({ questionId: question.id, asset }))
    );
    // A paper with no stored images settles on the first microtask, which is
    // what Promise.all of an empty list already gives us.
    void Promise.all(assets.map(async ({ questionId, asset }) => {
      const url = await getStorageFileDownloadUrl(asset.storagePath!);
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Could not load ${asset.title}.`));
        image.src = url;
      });
      return [assetKey(questionId, asset.id), url] as const;
    })).then((entries) => {
      if (!active) return;
      setAssetState({
        paperId,
        urls: Object.fromEntries(entries),
        settled: true,
        error: "",
      });
    }).catch(() => {
      if (!active) return;
      setAssetState({
        paperId,
        urls: {},
        settled: false,
        error: "A required paper image could not be loaded. Refresh before printing.",
      });
    });
    return () => { active = false; };
  }, [paper]);

  const loadedAssets = paper && assetState.paperId === paper.id ? assetState : null;
  const assetUrls = loadedAssets?.urls ?? {};
  const assetsSettled = loadedAssets?.settled ?? false;
  const assetError = loadedAssets?.error ?? "";

  const download = () => {
    if (!paper) return;
    const url = URL.createObjectURL(new Blob([buildTextExport(paper, includeReport)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${paper.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "practice-paper"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <AppPage title="Preparing paper" width="lg"><Skeleton className="h-96 rounded-xl" /></AppPage>;
  if (!paper) return <AppPage title="Paper unavailable" width="lg"><p className="text-sm text-text-muted">This practice paper could not be loaded.</p></AppPage>;

  return (
    <AppPage title={paper.title} backHref={`/dashboard/notebooks/${encodeURIComponent(notebookId)}`} backLabel="Notebook" width="lg" contentClassName="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-text-muted">Use your browser’s print dialog to print or save a PDF.</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={download}>Download text</Button>
          <Button type="button" disabled={!assetsSettled || Boolean(assetError)} onClick={() => window.print()}>
            {assetsSettled ? "Print or save PDF" : "Loading paper images..."}
          </Button>
        </div>
      </div>
      {assetError ? <p role="alert" className="print:hidden rounded-xl bg-error/10 p-3 text-sm text-error">{assetError}</p> : null}
      <article className="space-y-6 bg-white p-6 text-slate-950 print:p-0">
        <header className="border-b border-slate-300 pb-5">
          <h1 className="text-3xl font-semibold">{paper.title}</h1>
          <p className="mt-2 text-sm">{paper.totalMarks} marks{paper.durationMinutes ? ` · ${paper.durationMinutes} minutes` : ""}</p>
          {paper.instructions.length > 0 ? <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">{paper.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ul> : null}
          {paper.choiceGroups.map((group) => <p key={group.id} className="mt-2 text-sm font-semibold">{group.label}</p>)}
        </header>
        {paper.questions.map((question) => (
          <section key={question.id} className="break-inside-avoid border-b border-slate-200 pb-6">
            <div className="flex justify-between gap-4"><h2 className="text-base font-semibold">{question.label}</h2><span className="text-sm">[{question.marks}]</span></div>
            <StudyText text={question.prompt} as="p" className="mt-3 whitespace-pre-wrap text-sm leading-6" />
            {question.assets.map((asset) => (
              <Card
                key={assetKey(question.id, asset.id)}
                padding="sm"
                className="mt-4 border-slate-300 bg-slate-50 text-slate-950 shadow-none"
              >
                <h3 className="text-sm font-semibold">{asset.title}</h3>
                {assetUrls[assetKey(question.id, asset.id)] ? (
                  /*
                   * A short-lived signed URL for a private object, already
                   * loaded and cached above so the print dialog never opens
                   * over a half-rendered figure. next/image would proxy it
                   * through the optimiser, which cannot read a private path.
                   */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrls[assetKey(question.id, asset.id)]}
                    alt={asset.altText}
                    className="mt-2 h-auto max-h-[34rem] w-full object-contain"
                  />
                ) : (
                  <StudyText
                    text={asset.content || asset.caption || asset.altText}
                    as="pre"
                    className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6"
                  />
                )}
                {asset.altText ? (
                  <p className="mt-2 text-xs text-slate-600">{asset.altText}</p>
                ) : null}
              </Card>
            ))}
            <div className="mt-8 h-28 border-b border-dotted border-slate-300" />
          </section>
        ))}
        {includeReport && paper.result ? (
          <section className="break-before-page space-y-4">
            <h2 className="text-2xl font-semibold">Marking report</h2>
            <p className="text-xl font-semibold">{paper.result.awardedMarks}/{paper.result.totalMarks} · {paper.result.percentage}%{paper.result.gradeLabel ? ` · ${paper.result.gradeLabel}` : ""}</p>
            <StudyText text={paper.result.summary} as="p" className="text-sm leading-6" />
            {paper.result.questionResults.map((result) => <div key={result.questionId} className="break-inside-avoid border-t border-slate-200 pt-3"><div className="flex justify-between gap-4"><h3 className="font-semibold">{result.label}{result.counted ? "" : " · not counted"}</h3><span>{result.awardedMarks}/{result.maxMarks}</span></div><StudyText text={result.feedback} as="p" className="mt-2 text-sm leading-6" /></div>)}
          </section>
        ) : null}
      </article>
    </AppPage>
  );
}

export default function PracticePaperPrintPage() {
  return (
    <Suspense fallback={<AppPage title="Preparing paper" width="lg"><Skeleton className="h-96 rounded-xl" /></AppPage>}>
      <PracticePaperPrintContent />
    </Suspense>
  );
}
