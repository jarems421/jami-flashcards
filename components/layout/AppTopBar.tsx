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
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.35rem)" }}
    >
      <div className="app-topbar rounded-[1.45rem] border-[1.5px] border-white/[0.16] bg-[linear-gradient(180deg,rgba(31,22,56,0.86),rgba(19,12,38,0.86))] px-2.5 py-2.5 shadow-[0_16px_34px_rgba(7,2,22,0.22)] backdrop-blur-xl sm:rounded-[2rem] sm:px-4 sm:py-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
          <div className="flex min-h-[2.35rem] min-w-[4.75rem] items-center sm:min-h-[2.5rem] sm:min-w-[6rem]">
            {backHref && backLabel ? (
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-white/[0.07] hover:text-white sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
              >
                <span aria-hidden="true">&larr;</span>
                <span className="truncate">{backLabel}</span>
              </Link>
            ) : null}
          </div>

          <div className="min-w-0 text-center">
            <span className="text-[0.82rem] font-semibold text-warm-accent sm:text-[0.95rem]">
              Jami
            </span>
            <div className="mt-1.5 truncate text-sm font-medium text-white/95 sm:mt-2 sm:text-base">
              {title}
            </div>
          </div>

          <div className="flex min-h-[2.35rem] min-w-[4.75rem] items-center justify-end sm:min-h-[2.5rem] sm:min-w-[6rem]">
            {action ?? <div className="h-9 w-9 sm:h-10 sm:w-10" aria-hidden="true" />}
          </div>
        </div>
      </div>
    </div>
  );
}
