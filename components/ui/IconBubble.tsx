import { type CSSProperties, type ReactNode } from "react";

type IconBubbleSize = "xs" | "sm" | "md" | "lg";
type IconBubbleShape = "circle" | "rounded";

type IconBubbleProps = {
  children?: ReactNode;
  size?: IconBubbleSize;
  shape?: IconBubbleShape;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
};

const sizeClasses: Record<IconBubbleSize, string> = {
  xs: "h-6 w-6 text-[0.68rem]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-11 w-11 text-base",
};

const shapeClasses: Record<IconBubbleShape, string> = {
  circle: "rounded-full",
  rounded: "rounded-[1.05rem]",
};

export default function IconBubble({
  children,
  size = "md",
  shape = "rounded",
  className = "",
  style,
  "aria-hidden": ariaHidden,
}: IconBubbleProps) {
  return (
    <span
      aria-hidden={ariaHidden}
      style={style}
      className={`inline-grid box-border shrink-0 place-items-center text-center leading-none tabular-nums [font-variant-numeric:tabular-nums] [&>svg]:block [&>svg]:shrink-0 ${sizeClasses[size]} ${shapeClasses[shape]} ${className}`}
    >
      <span className="inline-grid h-full w-full place-items-center leading-none tabular-nums [&>svg]:block [&>svg]:shrink-0">
        {children}
      </span>
    </span>
  );
}
