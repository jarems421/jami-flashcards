import Link from "next/link";
import { type ReactNode } from "react";
import { BrandMark, ViewTabs, type ViewTabItem } from "@/components/ui";

type AppTopBarProps = {
  title: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  /**
   * Other views of the surface this page is one view of.
   *
   * They belong to the header rather than to the page below it. Rendered as
   * their own control they became a third bordered shell under the sidebar and
   * this bar, all three carrying the same frame and the same two-line items,
   * before a student reached any of their own work.
   */
  views?: ViewTabItem[];
  viewsLabel?: string;
  className?: string;
};

export default function AppTopBar({
  title,
  backHref,
  backLabel,
  action,
  views,
  viewsLabel,
  className = "",
}: AppTopBarProps) {
  // The tab row sits flush against the card's bottom edge, so its underline has
  // an edge to sit on rather than floating above the padding.
  const hasViews = Boolean(views && views.length > 0);
  return (
    <div
      className={className}
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.45rem)" }}
    >
      <div
        className={`app-topbar overflow-hidden rounded-xl border-[1.5px] border-[var(--topbar-border)] bg-[var(--topbar-bg)] px-3 pt-3 shadow-topbar backdrop-blur-xl sm:rounded-2xl sm:px-4 ${
          hasViews ? "pb-0" : "pb-3"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark size="lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">
                <span className="hidden sm:inline">Jami learning loop</span>
                <span className="sm:hidden">Jami</span>
              </div>
              <h1 className="mt-1 truncate text-base font-semibold leading-tight text-text-primary sm:text-xl">
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
            ) : (
              <div className="h-10 w-10 shrink-0" aria-hidden="true" />
            )}
          </div>
        </div>

        {views && hasViews ? (
          <ViewTabs items={views} label={viewsLabel ?? `${title} views`} />
        ) : null}
      </div>
    </div>
  );
}
