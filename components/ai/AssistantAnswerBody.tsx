"use client";

import { type ReactNode } from "react";
import AiResponse from "@/components/ai/AiResponse";
import { splitAssistantAnswerAtDiagram } from "@/lib/ai/assistant-answer-layout";
import type { AssistantIllustration } from "@/lib/ai/jami-assistant";

type AssistantAnswerBodyProps = {
  text: string;
  illustrations: readonly AssistantIllustration[];
  renderIllustration: (illustration: AssistantIllustration) => ReactNode;
};

/**
 * One answer, with at most one version of each figure in it.
 *
 * Jami can sketch a diagram itself inside the answer, and a student can then
 * ask for a proper illustration of the same thing. Both used to be shown -- the
 * sketch in the text and the image in a card below it -- so the answer carried
 * the same figure twice, in the wrong order, with the rougher one first.
 *
 * The image replaces the sketch and inherits its position, because that is
 * where the surrounding sentences already point. An illustration made for an
 * answer that never drew anything has no such position and goes at the end.
 */
export default function AssistantAnswerBody({
  text,
  illustrations,
  renderIllustration,
}: AssistantAnswerBodyProps) {
  if (illustrations.length === 0) {
    return <AiResponse content={text} className="select-text" />;
  }

  const layout = splitAssistantAnswerAtDiagram(text);

  return (
    <>
      {layout.before ? (
        <AiResponse content={layout.before} className="select-text" />
      ) : null}
      <div className="my-3 space-y-3">
        {illustrations.map((illustration) => renderIllustration(illustration))}
      </div>
      {layout.after ? (
        <AiResponse content={layout.after} className="select-text" />
      ) : null}
    </>
  );
}
