import { type HTMLAttributes } from "react";

type CardTone = "default" | "warm" | "subtle";
type CardPadding = "sm" | "md" | "lg";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: CardTone;
  padding?: CardPadding;
};

const toneClasses: Record<CardTone, string> = {
  default: "app-panel",
  warm: "app-panel-warm",
  subtle: "border-[1.5px] border-white/10 bg-white/[0.045] shadow-bubble",
};

const paddingClasses: Record<CardPadding, string> = {
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-6",
  lg: "p-5 sm:p-8",
};

export default function Card({
  tone = "default",
  padding = "md",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={`relative w-full min-w-0 max-w-full overflow-hidden rounded-[1.45rem] backdrop-blur-md transition duration-fast sm:rounded-[1.9rem] ${toneClasses[tone]} ${paddingClasses[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
