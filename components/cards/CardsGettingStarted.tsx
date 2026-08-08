import Link from "next/link";

type CardsGettingStartedProps = {
  deckCount: number;
  cardCount: number;
  topicCount: number;
  loading: boolean;
};

export default function CardsGettingStarted({
  deckCount,
  cardCount,
  topicCount,
  loading,
}: CardsGettingStartedProps) {
  if (loading || (deckCount > 0 && cardCount > 0 && topicCount > 0)) {
    return null;
  }

  return (
    <section className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:grid-cols-3">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          1. Decks
        </div>
        <div className="mt-2 text-sm font-medium text-text-primary">
          {deckCount > 0 ? `${deckCount} ready` : "Create a deck"}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          Decks group your cards by subject or exam.
        </p>
        {deckCount === 0 ? (
          <Link
            href="/dashboard/decks"
            className="mt-3 inline-flex text-xs font-semibold text-accent hover:text-text-primary"
          >
            Open decks
          </Link>
        ) : null}
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          2. Cards
        </div>
        <div className="mt-2 text-sm font-medium text-text-primary">
          {cardCount > 0 ? `${cardCount} ready` : "Add your first cards"}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          Single card and paste-list import live just below.
        </p>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          3. Topics
        </div>
        <div className="mt-2 text-sm font-medium text-text-primary">
          {topicCount > 0 ? `${topicCount} ready` : "Add Topics when useful"}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          Topics connect cards to the rest of your study material.
        </p>
      </div>
    </section>
  );
}
