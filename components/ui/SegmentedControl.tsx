"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SegmentedControlItem = {
  href: string;
  label: string;
  /** What this view is for, in the student's terms. */
  detail: string;
};

/**
 * Two or three views of one thing, switched between without leaving it.
 *
 * Built from links rather than buttons so every view has its own address: a
 * student can bookmark the one they use, the back button behaves, and another
 * page can send somebody straight to the right view.
 *
 * The point is that the views a student is *not* looking at stay visible. A
 * surface split across separate navigation entries hides half of itself from
 * anyone who has not found the other entry yet.
 */
export default function SegmentedControl({
  items,
  label,
}: {
  items: SegmentedControlItem[];
  label: string;
}) {
  // Typed as a string, but null wherever there is no router above this -- a
  // test harness, or a tree rendered outside the app shell. Nothing is marked
  // current in that case, which is better than the control throwing.
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label={label}
      className="app-nav flex w-full gap-1.5 overflow-x-auto rounded-xl border-[1.5px] border-[var(--nav-shell-border)] bg-[var(--nav-shell-bg)] p-1.5 scrollbar-hide sm:w-auto sm:self-start"
    >
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-4 py-2 text-left transition duration-fast sm:flex-none ${
              active
                ? "app-selected border"
                : "border border-transparent text-text-muted hover:border-[var(--color-border)] hover:bg-[var(--nav-hover-bg)] hover:text-text-primary"
            }`}
          >
            <span className="truncate text-sm font-semibold">{item.label}</span>
            <span
              className={`mt-0.5 truncate text-2xs leading-4 ${
                active ? "text-text-secondary" : "text-text-muted"
              }`}
            >
              {item.detail}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
