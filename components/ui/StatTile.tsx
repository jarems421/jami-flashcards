import Link from "next/link";
import { type ReactNode } from "react";
import Card from "./Card";

type StatTileProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
  tone?: "default" | "warm";
  className?: string;
};

export default function StatTile({
  label,
  value,
  detail,
  href,
  tone = "default",
  className = "",
}: StatTileProps) {
  const content = (
    <>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        {label}
      </div>
      <div className="mt-3 text-3xl font-black tracking-tight text-white">
        {value}
      </div>
      {detail ? (
        <p className="mt-2 text-sm leading-6 text-text-secondary">{detail}</p>
      ) : null}
    </>
  );

  if (href) {
    const panelClass = tone === "warm" ? "app-panel-warm" : "app-panel";
    return (
      <Link
        href={href}
        className={`${panelClass} block p-4 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell sm:p-5 ${className}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <Card tone={tone} padding="md" className={className}>
      {content}
    </Card>
  );
}
