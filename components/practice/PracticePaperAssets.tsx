import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";

function parseRows(content: string) {
  return content
    .split("\n")
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1 && !row.every((cell) => /^:?-+:?$/.test(cell)));
}

/** Trims a plotted value to something that fits an axis label. */
function axisLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * A single series of points the question supplied, drawn so it can be read.
 *
 * It previously plotted with no axis labels at all, which made the shape
 * visible but every value a guess -- on a graph a student is meant to answer
 * questions about. The ends of both scales are now printed, which is the
 * smallest thing that turns the picture back into data.
 *
 * One series, so no legend: the caption above the figure already names it.
 */
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
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  // Plot area, leaving a gutter wide enough for the scale labels.
  const left = 42;
  const right = 302;
  const top = 16;
  const bottom = 140;

  /*
   * Screen coordinates computed once. The old version joined every point into
   * a `points` string and then split that same string back apart to place the
   * markers, so the markers were parsed out of their own serialisation.
   */
  const plotted = points.map((point) => ({
    x: left + ((point.x - minX) / spanX) * (right - left),
    y: bottom - ((point.y - minY) / spanY) * (bottom - top),
  }));

  return (
    <svg
      viewBox="0 0 320 168"
      role="img"
      aria-label={altText || `Graph of ${points.length} plotted points`}
      className="h-auto w-full max-w-sm"
    >
      {/* Axes stay recessive: they locate the data, they are not the data. */}
      <path
        d={`M${left} ${top}V${bottom}H${right}`}
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth="1"
      />
      <g className="fill-text-muted tabular-nums" fontSize="9">
        <text x={left - 6} y={bottom} textAnchor="end" dominantBaseline="middle">
          {axisLabel(minY)}
        </text>
        <text x={left - 6} y={top} textAnchor="end" dominantBaseline="middle">
          {axisLabel(maxY)}
        </text>
        <text x={left} y={bottom + 14} textAnchor="start">
          {axisLabel(minX)}
        </text>
        <text x={right} y={bottom + 14} textAnchor="end">
          {axisLabel(maxX)}
        </text>
      </g>
      <polyline
        points={plotted.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {plotted.map((point, index) => (
        <circle
          key={`${points[index].x}-${points[index].y}-${index}`}
          cx={point.x}
          cy={point.y}
          r="4"
          fill="var(--color-accent)"
          /* A surface ring so markers stay countable where the line doubles back. */
          stroke="var(--color-surface-panel)"
          strokeWidth="1.5"
        />
      ))}
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
