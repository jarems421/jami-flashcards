import Link from "next/link";
import { type ReactNode } from "react";
import { BrandMark, ButtonLink } from "@/components/ui";

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
      <div className="app-topbar rounded-[1.45rem] border-[1.5px] border-[var(--topbar-border)] bg-[var(--topbar-bg)] px-3 py-3 shadow-[var(--topbar-shadow)] backdrop-blur-xl sm:rounded-[1.8rem] sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size="lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted">
                <span className="hidden sm:inline">Jami learning loop</span>
                <span className="sm:hidden">Jami</span>
              </div>
              <h1 className="mt-1 truncate text-[1.05rem] font-semibold leading-tight text-text-primary sm:text-[1.25rem]">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            {backHref && backLabel ? (
              <Link
                href={backHref}
                className="inline-flex min-h-[2.45rem] items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-xs font-semibold text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-strong,var(--color-glass-subtle))] hover:text-text-primary sm:text-sm"
              >
                <span aria-hidden="true">&larr;</span>
                <span className="truncate">{backLabel}</span>
              </Link>
            ) : (
              <div className="hidden sm:block" aria-hidden="true" />
            )}
            {action ? (
              <div className="min-w-0 shrink-0">{action}</div>
            ) : null}
            <ButtonLink
              href="/dashboard/profile"
              variant="surface"
              size="icon"
              aria-label="Account"
              title="Account"
              data-agent-nav="Account"
              data-agent-route="/dashboard/profile"
              className="ml-auto shrink-0"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path d="M7.5 6.5C7.5 4.015 9.515 2 12 2s4.5 2.015 4.5 4.5S14.485 11 12 11 7.5 8.985 7.5 6.5zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" />
              </svg>
              <span className="sr-only">Account</span>
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}
