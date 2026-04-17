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
}: PageHeroProps) {
  return (
    <Card tone={tone} padding="lg" className={`overflow-hidden ${className}`}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
            {eyebrow}
          </div>
          <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            {title}
          </h2>
          {description ? (
            <div className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
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
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </Card>
  );
}
