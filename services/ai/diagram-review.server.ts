import { generateGroundedResearch } from "@/lib/ai/gemini";
import { drawnFigureIssues } from "@/lib/practice/drawn-figure";

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
