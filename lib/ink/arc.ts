import type { InkPathCommand } from "@/lib/ink/model";

/**
 * Converts one SVG elliptical arc into absolute cubic Béziers.
 *
 * Follows the endpoint-to-centre conversion in the SVG implementation notes
 * (F.6.5), then splits the sweep into pieces of at most 90 degrees, where a
 * single cubic matches an ellipse to well under a thousandth of a unit. The
 * ink model has no arc command so the renderer, hit tests and the codec only
 * ever deal with M, L, C, Q and Z.
 *
 * A zero radius is a straight line and identical endpoints draw nothing, as
 * the SVG specification says.
 */
export function arcToCubics(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number
): InkPathCommand[] {
  if (x0 === x && y0 === y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ op: "L", x, y }];

  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // Radii too small to span the endpoints are scaled up until they just do.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const denominator = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const sign = largeArc === sweep ? -1 : 1;
  const coefficient =
    denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, (rx2 * ry2 - denominator) / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;

  const startAngle = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const endAngle = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
  let sweepAngle = endAngle - startAngle;
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2) - 1e-9));
  const step = sweepAngle / segments;
  const handle = (4 / 3) * Math.tan(step / 4);

  const toPage = (ux: number, uy: number) => ({
    x: cx + rx * cosPhi * ux - ry * sinPhi * uy,
    y: cy + rx * sinPhi * ux + ry * cosPhi * uy,
  });

  const commands: InkPathCommand[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = startAngle + step * i;
    const b = a + step;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const cosB = Math.cos(b);
    const sinB = Math.sin(b);
    const c1 = toPage(cosA - handle * sinA, sinA + handle * cosA);
    const c2 = toPage(cosB + handle * sinB, sinB - handle * cosB);
    // The final point is the exact endpoint, so rounding never leaves a gap.
    const end = i === segments - 1 ? { x, y } : toPage(cosB, sinB);
    commands.push({ op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y });
  }
  return commands;
}
