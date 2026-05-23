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
  default: "border-white/[0.09] bg-white/[0.045] text-white",
  good: "border-emerald-300/20 bg-emerald-400/[0.07] text-emerald-100",
  warm: "border-warm-border bg-warm-glow text-warm-accent",
  danger: "border-rose-300/20 bg-rose-400/[0.08] text-rose-100",
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
            <div className="mt-2 text-2xl font-semibold tracking-normal text-white">
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
      className={`flex flex-wrap items-center gap-2 rounded-[1.35rem] border border-white/[0.09] bg-white/[0.035] px-3 py-2 shadow-[0_12px_22px_rgba(4,8,18,0.12)] ${className}`}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex min-h-[2.45rem] min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 ${toneClasses[item.tone ?? "default"]}`}
        >
          <span className="truncate text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
            {item.label}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-white">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
