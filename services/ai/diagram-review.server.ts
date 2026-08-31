import { generateGroundedResearch } from "@/lib/ai/gemini";
import { sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

/**
 * A second pair of eyes on a drawn figure.
 *
 * A sanitised SVG is safe and well-formed. Neither says it is the right
 * picture: a triangle can be drawn cleanly with its three marked angles summing
 * to 190, a scattergram can plot points that contradict the table beside it,
 * and an axis can be labelled in the wrong units. The generator that wrote the
 * figure is not the one to ask.
 *
 * Two checks, because they catch different things and only one of them needs a
 * model.
 *
 * The arithmetic is done here. Angles in a triangle, marked lengths against a
 * stated scale, plotted points against a stated table -- these are stated in
 * the markup and are therefore checkable without asking anyone. A model asked
 * to add up three numbers is a worse adder than the code around it, and this is
 * the class of error a picture is most likely to carry.
 *
 * Whether the picture answers the question is a judgement, and that is what the
 * model is for: a correctly drawn right-angled triangle is still wrong if the
 * question is about a circle.
 */

export type DiagramReview = {
  questionId: string;
  assetId: string;
  issues: { code: string; detail: string }[];
};

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

/**
 * Ask Gemini whether the picture answers the question.
 *
 * Off unless web research is on, because it uses the same role and the same
 * gate. Returning no issues when it cannot run is deliberate: a review that
 * cannot be performed must not read as a review that passed, but it must also
 * not block a paper, so callers log the difference rather than treating silence
 * as approval.
 */
export async function reviewDrawnFigure(input: {
  questionId: string;
  assetId: string;
  prompt: string;
  altText: string;
  svg: string;
  timeoutMs?: number;
}): Promise<{ ran: boolean; issues: { code: string; detail: string }[] }> {
  const arithmetic = drawnFigureIssues(input);
  if (arithmetic.some((issue) => issue.code === "diagram_unusable")) {
    return { ran: false, issues: arithmetic };
  }

  const asked = await generateGroundedResearch({
    sanitizedQuery:
      `Does this exam figure answer its question? Question: ${input.prompt.slice(0, 200)}. ` +
      `The figure is described as: ${input.altText.slice(0, 200)}. ` +
      "Reply with the single word YES, or NO followed by one sentence saying what is wrong.",
    timeoutMs: input.timeoutMs ?? 45_000,
  });
  if (!asked.ok) return { ran: false, issues: arithmetic };

  const verdict = String(asked.brief ?? "").trim();
  if (/^\s*no\b/i.test(verdict)) {
    return {
      ran: true,
      issues: [
        ...arithmetic,
        {
          code: "diagram_does_not_answer",
          detail: verdict.replace(/^\s*no[:,\s-]*/i, "").slice(0, 300),
        },
      ],
    };
  }
  return { ran: true, issues: arithmetic };
}
