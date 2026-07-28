"use client";

import { Suspense, lazy, type ElementType } from "react";
import { hasMathDelimiters } from "@/lib/study/math-text";
import StudyTextSegments from "@/components/ui/StudyTextSegments";

type StudyTextProps = {
  text: string;
  as?: ElementType;
  className?: string;
};

/**
 * KaTeX is ~270 KB, and every card written before AI output moved to LaTeX
 * contains no maths delimiters at all, so it is loaded on demand rather than
 * shipped with the study and deck routes.
 *
 * React.lazy is used rather than next/dynamic because next/dynamic owns its own
 * Suspense boundary and its `loading` component cannot receive props. Here the
 * fallback needs the text, so it can render the same content through the plain
 * path instead of flashing blank.
 */
const MathText = lazy(() => import("@/components/ui/MathText"));

/**
 * Renders card text.
 *
 * Text containing balanced LaTeX delimiters is rendered with KaTeX; everything
 * else keeps the original Unicode superscript and fraction rendering. Existing
 * stored cards have no delimiters, so they render exactly as before and no data
 * migration is needed.
 */
export default function StudyText({
  text,
  as: Component = "span",
  className = "",
}: StudyTextProps) {
  if (!hasMathDelimiters(text)) {
    return <StudyTextSegments text={text} as={Component} className={className} />;
  }

  return (
    <Suspense
      fallback={<StudyTextSegments text={text} as={Component} className={className} />}
    >
      <MathText text={text} as={Component} className={className} />
    </Suspense>
  );
}
