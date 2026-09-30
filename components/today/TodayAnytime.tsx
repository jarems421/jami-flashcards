import type { ReactNode } from "react";

export type TodayAnytimeItem = {
  id: string;
  title: string;
  meta?: string;
  /** The way in, already built: a link or a button, sized small. */
  action: ReactNode;
};

/**
 * What can be done at any point today, as the last list on the page.
 *
 * Due cards, drafts waiting to be checked, a topic worth repairing, lighter
 * extra review: each used to be a card of its own, folded away behind "More
 * for today", so a student opening the fold met a second page. They are lines
 * in a list now, each with its one action, and the list is not drawn at all
 * when there is nothing on it.
 */
export default function TodayAnytime({ items }: { items: readonly TodayAnytimeItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="today-anytime-title" className="app-panel rounded-3xl p-4 sm:p-5">
      <h2 id="today-anytime-title" className="px-1 pb-2 text-base font-bold tracking-tight text-text-primary">
        Any time today
      </h2>
      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-1 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-text-primary">{item.title}</span>
              {item.meta ? <span className="mt-0.5 block truncate text-xs text-text-muted">{item.meta}</span> : null}
            </span>
            <span className="shrink-0">{item.action}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
