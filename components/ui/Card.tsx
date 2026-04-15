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
  subtle: "border-[1.5px] border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))] shadow-bubble",
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
      className={`relative overflow-hidden rounded-[1.8rem] backdrop-blur-md transition duration-fast sm:rounded-[2.8rem] ${toneClasses[tone]} ${paddingClasses[padding]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
