import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui";

type AuthShellProps = {
  children: ReactNode;
  /** A link at the end of the header, back to wherever this page came from. */
  back?: { href: string; label: string };
  /** Small print under the card. */
  footnote?: ReactNode;
};

/**
 * The frame for signing in and for the pages an emailed link opens.
 *
 * One card in the middle of the night sky, and nothing else competing with
 * it: these pages exist to get somebody through a form, so the form is the
 * whole composition. The sky itself is drawn by the root shell on every
 * signed-out route, which is why this frame has no background of its own.
 */
export default function AuthShell({ children, back, footnote }: AuthShellProps) {
  return (
    <main
      data-app-surface="true"
      className="relative flex min-h-[100dvh] flex-col overflow-x-hidden px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-text-primary sm:px-8"
    >
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md text-base font-semibold tracking-tight text-text-primary"
        >
          <BrandMark size="md" />
          Jami
        </Link>
        {back ? (
          <Link
            href={back.href}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition duration-fast hover:bg-[var(--button-ghost-bg-hover)] hover:text-text-primary"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M12 15 7 10l5-5" />
            </svg>
            {back.label}
          </Link>
        ) : null}
      </header>

      <div className="relative flex flex-1 flex-col items-center justify-center py-10 sm:py-14">
        <section className="signed-out-panel w-full max-w-md animate-slide-up rounded-2xl px-5 py-7 sm:px-8 sm:py-9">
          {children}
        </section>
        {footnote ? (
          <p className="mt-6 max-w-sm text-center text-xs leading-5 text-text-muted">
            {footnote}
          </p>
        ) : null}
      </div>
    </main>
  );
}
