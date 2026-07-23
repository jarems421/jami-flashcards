import { Fragment, type ElementType } from "react";
import { splitStudyTextForDisplay } from "@/lib/study/display-text";

type StudyTextProps = {
  text: string;
  as?: ElementType;
  className?: string;
};

export default function StudyText({
  text,
  as: Component = "span",
  className = "",
}: StudyTextProps) {
  const segments = splitStudyTextForDisplay(text);

  return (
    <Component className={className}>
      {segments.map((segment, index) =>
        segment.type === "sup" ? (
          <sup key={`${segment.type}-${index}`} className="text-[0.72em] leading-none">
            {segment.value}
          </sup>
        ) : segment.type === "fraction" ? (
          <span
            key={`${segment.type}-${index}`}
            className="mx-[0.12em] inline-grid min-w-[1.4em] grid-cols-1 grid-rows-[auto_1px_auto] align-middle font-[inherit] leading-none"
            data-study-fraction="true"
          >
            <span className="row-start-1 px-[0.2em] pb-[0.12em] text-center text-[0.86em]">
              <StudyText text={segment.numerator} />
            </span>
            <span
              aria-hidden="true"
              className="row-start-2 border-t border-current opacity-80"
            />
            <span className="sr-only">/</span>
            <span className="row-start-3 px-[0.2em] pt-[0.12em] text-center text-[0.86em]">
              <StudyText text={segment.denominator} />
            </span>
          </span>
        ) : (
          <Fragment key={`${segment.type}-${index}`}>{segment.value}</Fragment>
        )
      )}
    </Component>
  );
}
