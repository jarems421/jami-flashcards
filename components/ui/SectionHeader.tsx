import { type ReactNode } from "react";

type SectionHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export default function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted">
            {eyebrow}
          </div>
        ) : null}
        <h3 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          {title}
        </h3>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
