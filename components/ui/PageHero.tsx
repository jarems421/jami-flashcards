import { type ReactNode } from "react";
import Card from "./Card";

type PageHeroProps = {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  aside?: ReactNode;
  tone?: "default" | "warm";
  className?: string;
  compact?: boolean;
};

export default function PageHero({
  eyebrow,
  title,
  description,
  action,
  secondaryAction,
  aside,
  tone = "warm",
  className = "",
  compact = false,
}: PageHeroProps) {
  return (
    <Card tone={tone} padding={compact ? "md" : "lg"} className={`overflow-hidden ${className}`}>
      <div
        className={`flex flex-col lg:flex-row lg:justify-between ${
          compact ? "gap-4 lg:items-center" : "gap-6 lg:items-end"
        }`}
      >
        <div className={`min-w-0 flex-1 ${compact ? "max-w-xl" : "max-w-3xl"}`}>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            {eyebrow}
          </div>
          <h2 className={`${compact ? "mt-2" : "mt-3"} text-xl font-medium leading-tight tracking-tight text-text-primary sm:text-2xl xl:text-3xl`}>
            {title}
          </h2>
          {description ? (
            <div className={`${compact ? "mt-2 leading-6" : "mt-4 leading-7"} max-w-2xl text-sm text-text-muted sm:text-base`}>
              {description}
            </div>
          ) : null}
          {action || secondaryAction ? (
            <div className="mt-7 flex flex-wrap gap-3">
              {action}
              {secondaryAction}
            </div>
          ) : null}
        </div>
        {aside ? <div className="min-w-0 max-w-full shrink-0">{aside}</div> : null}
      </div>
    </Card>
  );
}
