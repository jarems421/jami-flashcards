import Link from "next/link";
import { type ReactNode } from "react";
import Card from "./Card";

type StatTileProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
  tone?: "default" | "warm";
  compact?: boolean;
  className?: string;
};

export default function StatTile({
  label,
  value,
  detail,
  href,
  tone = "default",
  compact = false,
  className = "",
}: StatTileProps) {
  const content = (
    <>
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
        {label}
      </div>
      <div className={`${compact ? "mt-1 text-lg" : "mt-3 text-xl sm:text-2xl"} font-semibold tracking-normal text-text-primary`}>
        {value}
      </div>
      {detail && !compact ? (
        <p className="mt-2 text-sm leading-6 text-text-secondary">{detail}</p>
      ) : null}
    </>
  );

  if (href) {
    const panelClass = tone === "warm" ? "app-panel-warm" : "app-panel";
    return (
      <Link
        href={href}
        className={`${panelClass} group block p-4 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell sm:p-5 ${className}`}
      >
        {content}
        <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <span>Open</span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5"
            aria-hidden="true"
          >
            <path d="M3.5 8h9" />
            <path d="m8.5 3 4.5 5-4.5 5" />
          </svg>
        </div>
      </Link>
    );
  }

  return (
    <Card tone={tone} padding="md" className={className}>
      {content}
    </Card>
  );
}
