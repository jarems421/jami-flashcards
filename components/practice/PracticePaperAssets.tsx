import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import { looksLikeSvg, sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";
import { useEffect, useState } from "react";
import { getStorageFileDownloadUrl } from "@/services/firebase/storage-files";
import NotebookGraphView from "@/components/workspace/NotebookGraphView";
import { describePaperGraph, readPaperGraph } from "@/lib/practice/paper-graph";

function PrivatePaperImage({ asset }: { asset: PracticePaperQuestionAsset }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!asset.storagePath) return;
    void getStorageFileDownloadUrl(asset.storagePath)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [asset.storagePath]);
  if (!url) {
    return <div className="aspect-[4/3] animate-pulse rounded-lg bg-[var(--color-glass-subtle)]" />;
  }
  // Private Firebase URLs are resolved only for the signed-in owner.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={asset.altText} className="h-auto w-full rounded-lg object-contain" />;
}

function parseRows(content: string) {
  return content
    .split("\n")
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1 && !row.every((cell) => /^:?-+:?$/.test(cell)));
}

/**
 * A question's graph, drawn from its data by the same renderer as notebook and
 * Tutor graphs: ruled axes at round steps, labelled quantities, and every point
 * where its numbers put it. Content that is not a graph is shown as written.
 */
function Graph({ content, altText, title }: { content: string; altText: string; title: string }) {
  // A chart drawn as SVG -- a bar chart, say -- is drawn like any diagram.
  if (looksLikeSvg(content)) return <DiagramAsset content={content} altText={altText} title={title} />;
  const graph = readPaperGraph(content);
  if (!graph) return <pre className="whitespace-pre-wrap text-xs leading-5">{content}</pre>;
  return (
    <div className="mx-auto aspect-[440/320] w-full max-w-md overflow-hidden rounded-lg" role="img" aria-label={altText || describePaperGraph(graph)}>
      <NotebookGraphView graph={graph} width={440} height={320} />
    </div>
  );
}

/**
 * A diagram, drawn where it is drawable and described where it is not.
 *
 * The designer may answer with SVG, because a labelled figure has to be exact:
 * angles that sum, points that match the table beside them, a scale that is
 * true. Everything it sends goes through the sanitiser first, and anything that
 * does not survive falls back to being read as text -- which is what every
 * diagram did before, so the floor is unchanged.
 */
function DiagramAsset({ content, altText, title }: { content: string; altText?: string; title: string }) {
  const drawn = looksLikeSvg(content) ? sanitizeSvgDiagram(content) : null;
  if (drawn?.ok) {
    return (
      <div
        role="img"
        aria-label={altText || title}
        className="mx-auto max-w-full overflow-x-auto rounded-lg bg-[var(--color-surface-page)] p-3 [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full"
        // Sanitised above: rebuilt from an element and attribute allowlist,
        // with no script, no foreignObject, no href and no event handlers.
        dangerouslySetInnerHTML={{ __html: drawn.svg }}
      />
    );
  }
  return (
    <div role="img" aria-label={altText || title} className="rounded-lg bg-[var(--color-glass-subtle)] p-3 text-center text-xs leading-6 whitespace-pre-wrap">
      {content}
    </div>
  );
}

export default function PracticePaperAssets({ assets }: { assets: PracticePaperQuestionAsset[] }) {
  if (assets.length === 0) return null;
  return (
    <div className="mt-3 space-y-3">
      {assets.map((asset) => {
        const rows = asset.type === "table" ? parseRows(asset.content) : [];
        return (
          <figure key={asset.id} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3">
            <figcaption className="mb-2 text-xs font-semibold text-text-primary">{asset.title}</figcaption>
            {asset.type === "table" && rows.length > 0 ? (
              /*
               * The first row is the header. It was rendered as `<td>` like
               * every other row, so the table announced itself to a screen
               * reader as an unlabelled grid and gave a sighted reader nothing
               * to anchor the columns to either.
               */
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {rows[0].map((cell, cellIndex) => (
                        <th
                          key={cellIndex}
                          scope="col"
                          className="border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2 py-1.5 font-semibold text-text-primary"
                        >
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(1).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td
                            key={cellIndex}
                            className="border border-[var(--color-border)] px-2 py-1.5 text-text-secondary"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : asset.type === "graph" ? (
              <Graph content={asset.content} altText={asset.altText} title={asset.title} />
            ) : asset.type === "diagram" ? (
              <DiagramAsset content={asset.content} altText={asset.altText} title={asset.title} />
            ) : (asset.type === "image" || asset.type === "illustration") && asset.storagePath ? (
              <PrivatePaperImage asset={asset} />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-text-secondary">{asset.content}</pre>
            )}
            {asset.altText ? <p className="sr-only">{asset.altText}</p> : null}
            {asset.caption ? <p className="mt-2 text-xs leading-5 text-text-muted">{asset.caption}</p> : null}
          </figure>
        );
      })}
    </div>
  );
}
