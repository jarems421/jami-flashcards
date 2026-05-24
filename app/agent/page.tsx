import Link from "next/link";
import AppPage from "@/components/layout/AppPage";
import { Card, PageHero, SectionHeader } from "@/components/ui";

const dashboardRoutes = [
  {
    href: "/dashboard?agent=1",
    label: "Today",
    purpose: "Start with the daily command centre and recommended next action.",
  },
  {
    href: "/dashboard/study?agent=1",
    label: "Learn",
    purpose: "Review seeded flashcards and inspect the learning queue.",
  },
  {
    href: "/dashboard/practise?agent=1",
    label: "Practise",
    purpose: "Try a question, self-mark, use Tutor, make a flashcard draft.",
  },
  {
    href: "/dashboard/practise?agent=1&forceTutorFallback=1",
    label: "Practise fallback QA",
    purpose: "Test every Tutor mode with deterministic local fallback responses and no AI budget use.",
  },
  {
    href: "/dashboard/progress?agent=1",
    label: "Progress",
    purpose: "Check weak topics, recent mistakes, drafts, and support level.",
  },
  {
    href: "/dashboard/library?agent=1",
    label: "Library",
    purpose: "Inspect seeded sources and source-to-draft flows.",
  },
  {
    href: "/dashboard/cards?agent=1",
    label: "Cards",
    purpose: "Browse all cards and local draft states.",
  },
  {
    href: "/dashboard/decks?agent=1",
    label: "Decks",
    purpose: "Understand deck/card-set organisation.",
  },
  {
    href: "/dashboard/goals?agent=1",
    label: "Goals",
    purpose: "Inspect study target examples.",
  },
  {
    href: "/dashboard/constellation?agent=1",
    label: "Stars",
    purpose: "Inspect reward/constellation examples.",
  },
  {
    href: "/dashboard/profile?agent=1",
    label: "Account",
    purpose: "Confirm public walkthrough mode and sign-in boundary.",
  },
];

const testFlow = [
  "Open Today and identify the recommended next action.",
  "Go to Learn and flip/review one seeded flashcard.",
  "Go to Practise, type an answer and working, then self-mark an attempt.",
  "Use Tutor: ask for a hint, use I'm stuck here, then make a flashcard draft.",
  "Go to Progress and confirm the mistake/draft/weak-topic state changed locally.",
  "Go to Library and inspect a source; source actions in public mode remain local-only.",
  "Go to Cards/Decks to confirm card organisation and draft status.",
  "Go to Account and confirm signed-out mode did not access private data.",
];

const phase4TestFlow = [
  "Open Practise.",
  "Type an answer and typed working.",
  "Click I'm stuck here.",
  "Highlight part of the Working textarea.",
  "Click Ask about selected text.",
  "Open Working tools.",
  "Draw on the scratchpad, then test Undo and Clear.",
  "Type a voice transcript fallback and send it to Tutor.",
  "Save one correct and one incorrect local attempt.",
  "Ask Tutor to make a flashcard and confirm the draft panel appears.",
  "Check the local practice session summary.",
  "Use /dashboard/practise?agent=1&forceTutorFallback=1 when you need deterministic Tutor responses.",
];

function AgentLink({
  href,
  label,
  purpose,
}: {
  href: string;
  label: string;
  purpose: string;
}) {
  return (
    <Link
      href={href}
      data-agent-route={href}
      className="group rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-4 text-left transition duration-fast hover:-translate-y-0.5 hover:border-warm-border hover:bg-white/[0.065]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{label}</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{purpose}</p>
        </div>
        <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-text-muted group-hover:text-warm-accent">
          Open
        </span>
      </div>
    </Link>
  );
}

export default function AgentPage() {
  return (
    <AppPage
      title="Agent Walkthrough"
      width="3xl"
      contentClassName="space-y-5 sm:space-y-6"
    >
      <PageHero
        eyebrow="LLM / browser agent entrypoint"
        title="Click through Jami without a real account."
        description="This page gives testing agents direct access to the public dashboard walkthrough. Signed-in users still use the real Firebase-backed app; signed-out agents get seeded local data and local-only interactions."
        action={
          <Link
            href="/dashboard?agent=1"
            data-agent-start="dashboard"
            className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105"
          >
            Start public dashboard
          </Link>
        }
        secondaryAction={
          <Link
            href="/llms.txt"
            className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] border border-white/14 bg-white/[0.05] px-5 py-3 text-base font-medium text-white transition duration-fast hover:border-white/22 hover:bg-white/[0.08]"
          >
            Plain-text route map
          </Link>
        }
      />

      <Card padding="lg">
        <SectionHeader
          title="Agent rules"
          description="Use these assumptions when testing as an unauthenticated browser agent."
        />
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["No login required", "/dashboard shows the public walkthrough when signed out."],
            ["Local-only actions", "Seeded attempts, drafts, and approvals do not write to Firebase."],
            ["Real auth preserved", "Private dashboards and persistent writes still require a signed-in account."],
          ].map(([title, detail]) => (
            <div key={title} className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4">
              <div className="text-sm font-semibold text-white">{title}</div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card padding="lg">
        <SectionHeader
          title="Direct route map"
          description="Open any route directly. The left navigation inside the dashboard exposes the same surfaces."
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboardRoutes.map((route) => (
            <AgentLink key={route.href} {...route} />
          ))}
        </div>
      </Card>

      <Card padding="lg">
        <SectionHeader
          title="Suggested click test"
          description="This is the shortest path through the current learning loop."
        />
        <ol className="mt-5 grid gap-2">
          {testFlow.map((step, index) => (
            <li
              key={step}
              className="flex gap-3 rounded-[1rem] border border-white/[0.08] bg-white/[0.035] px-3 py-3 text-sm leading-6 text-text-secondary"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-warm-border bg-warm-glow text-xs font-semibold text-warm-accent">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card padding="lg">
        <SectionHeader
          title="Phase 4 Practise/Tutor test"
          description="Use this checklist to verify the context packet, scratchpad, voice fallback, draft panel, and session summary in the public walkthrough."
        />
        <ol className="mt-5 grid gap-2">
          {phase4TestFlow.map((step, index) => (
            <li
              key={step}
              className="flex gap-3 rounded-[1rem] border border-white/[0.08] bg-white/[0.035] px-3 py-3 text-sm leading-6 text-text-secondary"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-warm-border bg-warm-glow text-xs font-semibold text-warm-accent">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </AppPage>
  );
}
