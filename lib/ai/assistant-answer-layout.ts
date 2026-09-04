/**
 * Where a generated illustration belongs in an answer that already drew one.
 *
 * Jami has two ways of showing a figure. It can draw one itself, as a fenced
 * `svg` block inside the answer, and a student can then ask for a proper
 * illustration, which comes back as an image. Both were rendered: the rough
 * inline sketch in the body, and the good one in a card underneath, so an
 * answer about a ladder against a wall showed the same diagram twice, worse
 * first.
 *
 * The image is the better artefact and the sketch's position is the right
 * position -- it sits exactly where the answer refers to it. So the fence is
 * removed and the image takes its place, which is what splitting the text here
 * is for.
 *
 * Every `svg` fence goes, not just the first: an answer that drew two sketches
 * and had one illustration made would otherwise keep the leftover.
 */

/** Matches one fenced ```svg block, including the fence lines themselves. */
function svgFence() {
  return /```svg\b[^\n]*\n[\s\S]*?```/g;
}

export type AssistantAnswerLayout = {
  /** Answer text before the diagram, or the whole answer when there is none. */
  before: string;
  /** Answer text after the diagram, with any further sketches removed. */
  after: string;
  /**
   * Whether a drawn sketch was taken out. False when the answer never drew one,
   * in which case the illustration has no natural home and belongs at the end.
   */
  replacedDiagram: boolean;
};

export function splitAssistantAnswerAtDiagram(
  content: string
): AssistantAnswerLayout {
  const first = svgFence().exec(content);
  if (!first) return { before: content, after: "", replacedDiagram: false };

  return {
    before: content.slice(0, first.index).trimEnd(),
    after: content
      .slice(first.index + first[0].length)
      .replace(svgFence(), "")
      .trimStart(),
    replacedDiagram: true,
  };
}
