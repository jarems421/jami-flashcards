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
      <div className="app-topbar rounded-[2.4rem] border-[1.5px] border-white/[0.18] bg-[linear-gradient(180deg,rgba(31,22,56,0.88),rgba(19,12,38,0.88))] px-3 py-3 shadow-[0_18px_40px_rgba(7,2,22,0.26)] backdrop-blur-xl sm:px-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-h-[2.5rem] min-w-[6rem] items-center">
            {backHref && backLabel ? (
              <Link
                href={backHref}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-white/[0.04] px-3 py-2 text-sm font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-white/[0.07] hover:text-white"
              >
                <span aria-hidden="true">&larr;</span>
                <span className="truncate">{backLabel}</span>
              </Link>
            ) : null}
          </div>

          <div className="min-w-0 text-center">
            <span className="text-[0.95rem] font-bold text-warm-accent">
              Jami
            </span>
            <div className="mt-2 truncate text-sm font-semibold text-white sm:text-base">
              {title}
            </div>
          </div>

          <div className="flex min-h-[2.5rem] min-w-[6rem] items-center justify-end">
            {action ?? <div className="h-10 w-10" aria-hidden="true" />}
          </div>
        </div>
      </div>
    </div>
  );
}
