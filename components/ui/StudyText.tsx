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
        ) : (
          <Fragment key={`${segment.type}-${index}`}>{segment.value}</Fragment>
        )
      )}
    </Component>
  );
}
