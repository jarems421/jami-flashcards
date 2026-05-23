import Link from "next/link";
import { type ReactNode } from "react";

type AppTopBarProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  className?: string;
};

export default function AppTopBar({
  title,
  backHref,
  backLabel,
  action,
  className = "",
}: AppTopBarProps) {
  return (
    <div
      className={className}
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.45rem)" }}
    >
      <div className="app-topbar rounded-[1.45rem] border-[1.5px] border-white/[0.12] bg-[linear-gradient(180deg,rgba(18,23,35,0.86),rgba(10,13,22,0.78))] px-3 py-3 shadow-[0_18px_38px_rgba(4,8,18,0.26)] backdrop-blur-xl sm:rounded-[1.8rem] sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.05rem] border border-warm-border bg-warm-glow text-sm font-semibold text-warm-accent shadow-[0_12px_24px_rgba(4,8,18,0.18)]">
              J
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted">
                <span className="hidden sm:inline">Jami learning loop</span>
                <span className="sm:hidden">Jami</span>
              </div>
              <h1 className="mt-1 truncate text-[1.05rem] font-semibold leading-tight text-white sm:text-[1.25rem]">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 sm:justify-end">
            {backHref && backLabel ? (
              <Link
                href={backHref}
                className="inline-flex min-h-[2.45rem] items-center gap-2 rounded-full border border-white/14 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-text-secondary transition duration-fast hover:border-white/22 hover:bg-white/[0.08] hover:text-white sm:text-sm"
              >
                <span aria-hidden="true">&larr;</span>
                <span className="truncate">{backLabel}</span>
              </Link>
            ) : (
              <div aria-hidden="true" />
            )}
            {action ? (
              <div className="shrink-0">{action}</div>
            ) : (
              <div className="h-10 w-10 shrink-0" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
