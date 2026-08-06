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
    // Malformed legacy maths is rendered as visible source text below.
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

        /*
         * Inline maths is a word in a sentence, so it is left inline.
         *
         * It used to be an inline-block that could scroll, which is what made
         * every expression float above the line it belonged to: an inline-block
         * whose overflow is not `visible` takes its baseline from its bottom
         * margin edge instead of from its contents, so the box was hung by its
         * foot from the text baseline rather than standing on it. The
         * `align-[-0.08em]` here was an attempt to nudge that back, but the
         * error grows with the height of the expression, so nothing constant
         * could correct it.
         *
         * Display maths keeps its scroll container: it is a block on its own
         * line, where there is no baseline to share.
         */
        if (!segment.display && segment.trailingPunctuation) {
          return (
            <span key={`math-${index}`} className="inline whitespace-nowrap">
              <span
                data-jami-math="true"
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
                : ""
            }
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </Component>
  );
}
