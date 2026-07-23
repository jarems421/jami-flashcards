"use client";

import { Fragment } from "react";
import katex from "katex";
import {
  attachInlineMathPunctuation,
  normalizeLegacyJamiMathText,
  splitMathRichText,
} from "@/lib/study/math-text";
import { StudyText } from "@/components/ui";

type JamiResponseTextProps = {
  text: string;
  className?: string;
};

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

export default function JamiResponseText({
  text,
  className = "",
}: JamiResponseTextProps) {
  const segments = attachInlineMathPunctuation(
    splitMathRichText(normalizeLegacyJamiMathText(text))
  );

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return (
            <Fragment key={`text-${index}`}>
              <StudyText text={segment.value} />
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
    </span>
  );
}
