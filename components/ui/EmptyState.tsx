import { type ReactNode } from "react";
import Card from "./Card";

type EmptyStateProps = {
  emoji?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  helperText?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  variant?: "default" | "compact" | "plain";
  align?: "center" | "left";
};

export default function EmptyState({
  emoji,
  eyebrow,
  title,
  description,
  helperText,
  action,
  secondaryAction,
  variant = "default",
  align = "center",
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const isWordIcon = Boolean(emoji && emoji.length > 2);
  const textAlign = align === "left" ? "text-left" : "text-center";
  const iconAlign = align === "left" ? "" : "mx-auto";

  const content = (
    <>
      {emoji ? (
        <div
          className={`${iconAlign} flex ${isCompact ? "h-11 min-w-11" : "h-14 min-w-14"} ${isWordIcon ? "px-3 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-warm-accent" : isCompact ? "w-11 text-2xl" : "w-14 text-3xl"} items-center justify-center rounded-[1.4rem] border border-white/15 bg-white/[0.07] shadow-[0_10px_24px_rgba(8,2,26,0.18)]`}
        >
          {emoji}
        </div>
      ) : null}
      {eyebrow ? (
        <div className={`${emoji ? "mt-4" : ""} text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted`}>
          {eyebrow}
        </div>
      ) : null}
      <h3 className={`${eyebrow || emoji ? "mt-3" : ""} ${isCompact ? "text-base" : "text-lg sm:text-xl"} font-medium tracking-tight text-white`}>
        {title}
      </h3>
      {description ? (
        <p className={`${isCompact ? "mt-2" : "mt-3"} max-w-2xl text-sm leading-6 text-text-secondary ${align === "center" ? "mx-auto" : ""}`}>
          {description}
        </p>
      ) : null}
      {helperText ? (
        <p className={`${isCompact ? "mt-2" : "mt-3"} max-w-2xl text-xs leading-5 text-text-muted ${align === "center" ? "mx-auto" : ""}`}>
          {helperText}
        </p>
      ) : null}
      {action || secondaryAction ? (
        <div className={`${isCompact ? "mt-4" : "mt-5"} flex flex-wrap gap-3 ${align === "center" ? "justify-center" : ""}`}>
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </>
  );

  if (variant === "plain") {
    return <div className={`animate-fade-in ${textAlign}`}>{content}</div>;
  }

  return (
    <Card
      tone="warm"
      padding={isCompact ? "md" : "lg"}
      className={`animate-fade-in ${textAlign}`}
    >
      {content}
    </Card>
  );
}
