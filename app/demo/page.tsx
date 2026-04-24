import Link from "next/link";
import AppPage from "@/components/layout/AppPage";
import DemoLoginButton from "@/components/demo/DemoLoginButton";
import { Card, EmptyState, PageHero, StatTile } from "@/components/ui";
import { RecentChangesPanel, RetentionHealthPanel, StreakPredictionPanel, WeakAreasPanel } from "@/components/stats/AnalyticsPanels";
import { DEMO_RESET_COPY } from "@/lib/demo/shared";
import { buildSpacedRepetitionAnalytics } from "@/lib/study/analytics";
import { predictStudyStreak } from "@/lib/study/streak-prediction";
import { loadDemoSnapshot } from "@/services/demo/admin";

export const runtime = "nodejs";

export default async function DemoPage() {
  const snapshot = await loadDemoSnapshot();

  if (!snapshot) {
    return (
      <AppPage title="Demo" backHref="/" backLabel="Home" width="2xl">
        <EmptyState
          emoji="Demo"
          eyebrow="Unavailable"
          title="Public demo is offline"
          description="Demo mode is not configured for this deployment right now."
          action={
            <Link
              href="/"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover"
            >
              Back home
            </Link>
          }
        />
      </AppPage>
    );
  }

  const deckNamesById = Object.fromEntries(snapshot.decks.map((deck) => [deck.id, deck.name]));
  const analytics = buildSpacedRepetitionAnalytics(snapshot.cards, snapshot.activity, deckNamesById);
  const prediction = predictStudyStreak(snapshot.cards, snapshot.activity);
  const completedGoals = snapshot.goals.filter((goal) => goal.status === "completed").length;

  return (
    <AppPage
      title="Public Demo"
      backHref="/"
      backLabel="Home"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      <PageHero
        eyebrow="Public demo"
        title="See how Jami feels before you sign in."
        description={
          <>
            <span className="mb-3 block text-sm text-text-secondary">
              This preview is read-only and server-rendered from a seeded workspace. If you want to feel the review loop, the shared study session opens a safe study-only account without exposing an email or password.
            </span>
            {DEMO_RESET_COPY}
          </>
        }
        tone="warm"
        action={
          <DemoLoginButton
            label="Try shared study session"
            redirectTo="/dashboard/study"
          />
        }
        secondaryAction={
          <Link
            href="/"
            className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
          >
            Back home
          </Link>
        }
        aside={
          <div className="grid min-w-[15rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
            <div>
              <div className="text-xs text-text-muted">Demo learner</div>
              <div className="mt-1 text-xl font-medium text-white sm:text-2xl">
                {snapshot.username ?? "Jami Demo"}
              </div>
            </div>
            <div className="h-px bg-white/[0.08]" />
            <div>
              <div className="text-xs text-text-muted">Completed goals</div>
              <div className="mt-1 text-lg font-medium text-white sm:text-xl">{completedGoals}</div>
            </div>
          </div>
        }
      />

      <div className="grid gap-3 sm:gap-4 md:grid-cols-4">
        <StatTile label="Decks" value={snapshot.decks.length} detail="Seeded subjects." />
        <StatTile label="Cards" value={snapshot.cards.length} detail="Mixed review states." />
        <StatTile label="Reviewed days" value={snapshot.activity.length} detail="Realistic study history." />
        <StatTile label="Stars" value={snapshot.stars.length} detail="Goal rewards already earned." />
      </div>

      <Card padding="lg" className="animate-fade-in">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.3rem] border border-white/[0.08] bg-white/[0.045] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-text-muted">Memory-aware review</div>
            <div className="mt-3 text-base font-semibold text-white">The study loop is ranked, not just sorted.</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Daily Review combines FSRS scheduling with memory-risk prioritisation so weaker cards surface earlier.
            </p>
          </div>
          <div className="rounded-[1.3rem] border border-white/[0.08] bg-white/[0.045] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-text-muted">Signal-rich analytics</div>
            <div className="mt-3 text-base font-semibold text-white">The next move stays obvious.</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Retention health, weak areas, recent changes, and streak pressure all point back to what deserves attention.
            </p>
          </div>
          <div className="rounded-[1.3rem] border border-white/[0.08] bg-white/[0.045] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-text-muted">Safe shared session</div>
            <div className="mt-3 text-base font-semibold text-white">You can test the review flow without breaking the workspace.</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              The shared account lets you study the seeded cards while keeping editing, profile changes, and notifications locked.
            </p>
          </div>
        </div>
      </Card>

      <StreakPredictionPanel prediction={prediction} />
      <RetentionHealthPanel analytics={analytics} />
      <div className="grid gap-4 lg:grid-cols-2">
        <WeakAreasPanel analytics={analytics} />
        <RecentChangesPanel analytics={analytics} />
      </div>
    </AppPage>
  );
}
