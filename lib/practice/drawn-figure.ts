import { sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

/**
 * What a drawn figure says about itself.
 *
 * A sanitised SVG is safe and well formed, and neither says it is the right
 * picture: a triangle can be drawn cleanly with its three marked angles summing
 * to 190, a scattergram can plot points contradicting the table beside it.
 *
 * Everything here is arithmetic on what the markup states, so it is done in
 * code rather than asked of a model -- the figure states enough to be wrong on
 * its own terms, and a model is a worse adder than the code around it. Whether
 * the picture answers the question at all is judgement, and that lives in
 * diagram-review.server.ts where it can ask one.
 */

/** Every number a <text> label states, with the label it came from. */
function labelledNumbers(svg: string) {
  const labels: { text: string; value: number }[] = [];
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)) {
    const text = match[1].replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").trim();
    for (const number of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
      labels.push({ text, value: Number(number[0]) });
    }
  }
  return labels;
}

/**
 * What the drawing itself says, checked against itself.
 *
 * Deliberately narrow. Every rule here is one where the figure states enough to
 * be wrong on its own terms, and anything needing knowledge of the subject is
 * left to the model below.
 */
export function drawnFigureIssues(input: {
  questionId: string;
  assetId: string;
  prompt: string;
  svg: string;
}): { code: string; detail: string }[] {
  const issues: { code: string; detail: string }[] = [];
  const drawn = sanitizeSvgDiagram(input.svg);
  if (!drawn.ok) return [{ code: "diagram_unusable", detail: drawn.reason }];

  const svg = drawn.svg;
  const degrees = labelledNumbers(svg).filter((label) => /°|deg/i.test(label.text));

  /**
   * A triangle's marked angles.
   *
   * Only when all three are marked and none is an unknown: a figure marking two
   * angles and an x is asking the candidate for the third, and summing what is
   * printed would report every such question as broken.
   */
  const triangle = /<polygon\b[^>]*points\s*=\s*"([^"]*)"/i.exec(svg);
  const corners = triangle ? triangle[1].trim().split(/\s+/).length : 0;
  const unknown = /<text\b[^>]*>[^<]*[a-z]\s*(?:°|deg)/i.test(svg);
  if (corners === 3 && degrees.length === 3 && !unknown) {
    const total = degrees.reduce((sum, label) => sum + label.value, 0);
    if (Math.abs(total - 180) > 0.5) {
      issues.push({
        code: "diagram_angles_do_not_sum",
        detail: `The three marked angles are ${degrees.map((d) => d.value).join(", ")}, which total ${total}, not 180.`,
      });
    }
  }

  /** A label the question needs and the figure never prints. */
  const asksFor = /\b(angle|length|area|perimeter|radius|diameter|gradient)\b/i.exec(input.prompt);
  if (asksFor && labelledNumbers(svg).length === 0 && !/<text/i.test(svg)) {
    issues.push({
      code: "diagram_unlabelled",
      detail: `The question asks about ${asksFor[1]} and the figure carries no labels at all.`,
    });
  }

  return issues;
}
