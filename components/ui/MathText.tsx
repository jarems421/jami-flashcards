"use client";

import { Fragment, type ElementType } from "react";
import katex from "katex";
import {
  attachInlineMathPunctuation,
  normalizeLegacyJamiMathText,
  splitMathRichText,
} from "@/lib/study/math-text";
import StudyTextSegments from "@/components/ui/StudyTextSegments";

type MathTextProps = {
  text: string;
  as?: ElementType;
  className?: string;
};

/**
 * Renders study text that contains LaTeX maths.
 *
 * Uses katex.renderToString directly rather than the react-markdown pipeline
 * behind AiResponseRenderer: card faces need equations, not block Markdown, and
 * this keeps the unified/remark/rehype stack out of the study and deck routes.
 *
 * Only reached via StudyText when the text actually contains balanced maths
 * delimiters, so plain cards never pay for KaTeX.
 */
function renderMath(expression: string, displayMode: boolean) {
  try {
    return katex.renderToString(expression, {
      displayMode,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false,
    });
  } catch {
    return "";
  }
}

export default function MathText({
  text,
  as: Component = "span",
  className = "",
}: MathTextProps) {
  const segments = attachInlineMathPunctuation(
    splitMathRichText(normalizeLegacyJamiMathText(text))
  );

  return (
    <Component className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <Fragment key={`text-${index}`}>
              <StudyTextSegments text={segment.value} />
            </Fragment>
          );
        }

        const html = renderMath(segment.value, segment.display);
        if (!html) {
          return (
            <span key={`math-fallback-${index}`} className="font-mono">
              {segment.value}
              {segment.trailingPunctuation}
            </span>
          );
        }

        if (!segment.display && segment.trailingPunctuation) {
          return (
            <span key={`math-${index}`} className="inline whitespace-nowrap">
              <span
                data-jami-math="true"
                className="inline-block max-w-full overflow-x-auto overflow-y-hidden align-[-0.08em]"
                dangerouslySetInnerHTML={{ __html: html }}
              />
              {segment.trailingPunctuation}
            </span>
          );
        }

        return (
          <span
            key={`math-${index}`}
            data-jami-math="true"
            className={
              segment.display
                ? "my-2 block max-w-full overflow-x-auto overflow-y-hidden py-1 text-center"
                : "inline-block max-w-full overflow-x-auto overflow-y-hidden align-[-0.08em]"
            }
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </Component>
  );
}
