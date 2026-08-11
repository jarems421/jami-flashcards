import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";

function parseRows(content: string) {
  return content
    .split("\n")
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1 && !row.every((cell) => /^:?-+:?$/.test(cell)));
}

function Graph({ content, altText }: { content: string; altText: string }) {
  const points = content.split("\n").flatMap((row) => {
    const numbers = row.split(/[,\s]+/).map(Number);
    return numbers.length >= 2 && numbers.slice(0, 2).every(Number.isFinite)
      ? [{ x: numbers[0], y: numbers[1] }]
      : [];
  });
  if (points.length < 2) return <pre className="whitespace-pre-wrap text-xs leading-5">{content}</pre>;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const plotted = points.map((point) => `${20 + ((point.x - minX) / Math.max(1, maxX - minX)) * 260},${150 - ((point.y - minY) / Math.max(1, maxY - minY)) * 120}`).join(" ");
  return (
    <svg viewBox="0 0 300 170" role="img" aria-label={altText || "Question graph"} className="h-auto w-full max-w-sm">
      <path d="M20 15V150H285" fill="none" stroke="currentColor" opacity="0.45" />
      <polyline points={plotted} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinejoin="round" />
      {points.map((point, index) => {
        const [x, y] = plotted.split(" ")[index].split(",").map(Number);
        return <circle key={`${point.x}-${point.y}-${index}`} cx={x} cy={y} r="3.5" fill="var(--color-accent)" />;
      })}
    </svg>
  );
}

export default function PracticePaperAssets({ assets }: { assets: PracticePaperQuestionAsset[] }) {
  if (assets.length === 0) return null;
  return (
    <div className="mt-3 space-y-3">
      {assets.map((asset) => {
        const rows = asset.type === "table" ? parseRows(asset.content) : [];
        return (
          <figure key={asset.id} className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3">
            <figcaption className="mb-2 text-xs font-semibold text-text-primary">{asset.title}</figcaption>
            {asset.type === "table" && rows.length > 0 ? (
              <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border border-[var(--color-border)] px-2 py-1.5">{cell}</td>)}</tr>)}</tbody></table></div>
            ) : asset.type === "graph" ? (
              <Graph content={asset.content} altText={asset.altText} />
            ) : asset.type === "diagram" ? (
              <div role="img" aria-label={asset.altText || asset.title} className="rounded-lg bg-[var(--color-glass-subtle)] p-3 text-center text-xs leading-6 whitespace-pre-wrap">{asset.content}</div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-text-secondary">{asset.content}</pre>
            )}
            {asset.altText ? <p className="sr-only">{asset.altText}</p> : null}
          </figure>
        );
      })}
    </div>
  );
}
