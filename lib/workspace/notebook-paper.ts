export const NOTEBOOK_RULE_SPACING = 40;
export const NOTEBOOK_GRID_SPACING = 45;
export const NOTEBOOK_DOT_SPACING = 28;
export const NOTEBOOK_DOT_RADIUS = 1.35;

function finitePositive(value: number) {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

export function getNotebookCompleteGridLines(
  length: number,
  spacing = NOTEBOOK_GRID_SPACING
) {
  const boundedLength = finitePositive(length);
  const boundedSpacing = finitePositive(spacing);
  const cellCount = Math.floor(boundedLength / boundedSpacing);
  if (cellCount === 0) return [];
  const usedLength = cellCount * boundedSpacing;
  const inset = (boundedLength - usedLength) / 2;

  return Array.from(
    { length: cellCount + 1 },
    (_, index) => inset + index * boundedSpacing
  );
}

export function getNotebookRuledLines(
  length: number,
  spacing = NOTEBOOK_RULE_SPACING
) {
  const boundedLength = finitePositive(length);
  const boundedSpacing = finitePositive(spacing);
  const lines: number[] = [];
  for (let position = boundedSpacing; position < boundedLength; position += boundedSpacing) {
    lines.push(position);
  }
  return lines;
}
