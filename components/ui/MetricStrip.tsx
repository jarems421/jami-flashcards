import { type ReactNode } from "react";

export type MetricStripItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "good" | "warm" | "danger";
};

type MetricStripProps = {
  items: MetricStripItem[];
  variant?: "full" | "compact";
  className?: string;
};

const toneClasses: Record<NonNullable<MetricStripItem["tone"]>, string> = {
  default: "app-chip",
  good: "border-success/35 bg-success-muted text-[var(--color-success-text)]",
  warm: "border-warm-border bg-warm-glow text-warm-accent",
  danger: "border-error/35 bg-error-muted text-[var(--color-error-text)]",
};

export default function MetricStrip({
  items,
  variant = "compact",
  className = "",
}: MetricStripProps) {
  if (variant === "full") {
    return (
      <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className}`}>
        {items.map((item) => (
          <div
            key={item.label}
            className={`rounded-[1.35rem] border px-4 py-4 shadow-[0_12px_22px_rgba(4,8,18,0.12)] ${toneClasses[item.tone ?? "default"]}`}
          >
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
              {item.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-normal text-text-primary">
              {item.value}
            </div>
            {item.detail ? (
              <p className="mt-2 text-sm leading-6 text-text-secondary">{item.detail}</p>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`app-subtle-panel flex max-w-full flex-wrap items-center gap-2 overflow-hidden rounded-[1.35rem] px-3 py-2 shadow-[0_12px_22px_rgba(4,8,18,0.12)] ${className}`}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex min-h-[2.45rem] min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 ${toneClasses[item.tone ?? "default"]}`}
        >
          <span className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
            {item.label}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
