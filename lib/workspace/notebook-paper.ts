export const NOTEBOOK_RULE_SPACING = 40;
export const NOTEBOOK_GRID_SPACING = 45;
export const NOTEBOOK_DOT_SPACING = 28;
export const NOTEBOOK_DOT_RADIUS = 1.35;

function finitePositive(value: number) {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

/**
 * Grid lines that divide a page edge to edge, every cell the same size.
 *
 * The spacing is a preference rather than a measurement, and is stretched or
 * squeezed to the nearest size that fits a whole number of times. Keeping it
 * exact instead leaves a remainder, and there is nowhere to put a remainder on
 * a page: laying the cells out from one edge leaves a stub at the other, and
 * centring them leaves half a stub at each. The page is 900 by 1240, so the
 * columns came out exactly and the rows were left with twenty-five units to
 * split -- a band top and bottom about a quarter of a cell tall, which is the
 * row of half-squares.
 *
 * Fitting each axis separately means the cells are not quite square when the
 * page is not a whole number of cells in both directions: at the notebook's own
 * size they come out 45 across and 44.3 down, which is under two per cent and
 * not visible. A cell that is genuinely square everywhere would have to divide
 * both 900 and 1240, and the largest that does is 20 -- less than half the size
 * these are meant to be.
 */
export function getNotebookCompleteGridLines(
  length: number,
  spacing = NOTEBOOK_GRID_SPACING
) {
  const boundedLength = finitePositive(length);
  const boundedSpacing = finitePositive(spacing);
  const cellCount = Math.max(1, Math.round(boundedLength / boundedSpacing));
  const fittedSpacing = boundedLength / cellCount;

  return Array.from(
    { length: cellCount + 1 },
    (_, index) => index * fittedSpacing
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
