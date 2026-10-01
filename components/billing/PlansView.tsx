"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, IconBubble, OptionSwitch } from "@/components/ui";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/Dialog";
import { CHECKOUT_WAIVER_TEXT, type CheckoutKind } from "@/lib/billing/checkout";
import {
  ALLOWANCE_KEYS,
  ALLOWANCE_LABELS,
  PLAN_LABELS,
  PLAN_PRICES_PENCE,
  getExamPassExpiry,
  getExamPassMonths,
  getExamPassPricePence,
  type AllowanceKey,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";
import type { PlanSummary } from "@/lib/billing/summary";
import {
  describePassAllowance,
  describePlanAllowance,
  describeUpgradeFor,
  getExamPassQuote,
  getPlanComparisonRows,
} from "@/lib/billing/upsell";
import { CheckoutError, startCheckout } from "@/services/billing/checkout";
import { loadPlanSummary } from "@/services/billing/plan-summary-store";

/**
 * Choosing a plan.
 *
 * Reached only on purpose: from "See plans" after running out of something,
 * from the plan row on Account, or from Usage. Nothing here counts down,
 * nothing is "limited time", and "Free" is shown as a real plan rather than a
 * trap. Buying asks once, in plain words, for the 14-day waiver; a student can
 * also make a link for a parent to pay on their own device.
 *
 * The Exam Pass is the cheaper way to pay, so it leads with what it works out
 * at each month and shows each allowance across the whole pass, rather than
 * one large price beside the same monthly numbers.
 */

type ShownPlan = Exclude<PlanId, "lifetime">;

/** The two things a plan is mostly chosen for, shown large on each card. */
const HEADLINE_ROWS: AllowanceKey[] = ["papers", "tutor"];
const CARD_ROWS: AllowanceKey[] = ["answers", "searches", "photos", "videos"];

const TAGLINES: Record<ShownPlan, string> = {
  free: "Try everything, with small monthly amounts.",
  plus: "For steady revision across your subjects.",
  pro: "For heavy exam prep and lots of papers.",
};

const ALWAYS_FREE = ["Flashcards and decks", "Notebooks", "Folders and sources", "Your planner", "Constellations"];

// Full class strings so Tailwind keeps them. Each plan has its own light: the
// same washes the Tutor door uses, from the theme's own tokens.
const PLAN_STYLE: Record<ShownPlan, { card: string; wash: string; glyph: string }> = {
  free: {
    card: "border-[var(--color-border-strong)]",
    wash: "bg-[radial-gradient(120%_90%_at_0%_0%,var(--color-glass-medium)_0%,transparent_62%)]",
    glyph: "bg-[var(--color-glass-medium)] text-text-secondary",
  },
  plus: {
    card: "border-accent shadow-accent",
    wash: "bg-[radial-gradient(120%_90%_at_0%_0%,var(--color-accent-muted)_0%,transparent_62%)]",
    glyph: "bg-accent-muted text-accent",
  },
  pro: {
    card: "border-warm-border",
    wash: "bg-[radial-gradient(120%_90%_at_0%_0%,var(--color-warm-glow)_0%,transparent_62%)]",
    glyph: "border border-warm-border bg-warm-glow text-warm-accent",
  },
};

const ROW_LABELS: Partial<Record<AllowanceKey, string>> = {
  papers: "Jami papers",
  answers: "Marked answers",
  tutor: "Tutor questions",
  searches: "Web searches",
  photos: "Tutor photos",
  videos: "Video imports",
  revisionSessions: "Revision Sessions",
  paperMarkings: "Paper markings",
  diagramLabels: "Label finds",
  pages: "Searchable pages",
};

function rowLabel(key: AllowanceKey) {
  const label = ROW_LABELS[key] ?? ALLOWANCE_LABELS[key];
  return `${label[0].toUpperCase()}${label.slice(1)}`;
}

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function PlansView({
  highlight,
  checkoutSucceeded,
}: {
  highlight: AllowanceKey | null;
  /** Back from Stripe after paying: the webhook may take a moment to grant the plan. */
  checkoutSucceeded: boolean;
}) {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [kind, setKind] = useState<CheckoutKind>("subscription");
  const [buying, setBuying] = useState<{ plan: PaidPlanId; forParent: boolean } | null>(null);
  // One "now" for the whole visit, so prices cannot shift between render and checkout.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    loadPlanSummary(true)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const current: PlanId | null = summary?.enabled ? summary.plan : null;
  const lifetime = current === "lifetime";
  // In UTC: the pass ends at the last moment of 31 July UTC, which is already
  // 1 August in British Summer Time.
  const passUntil = new Date(getExamPassExpiry(now)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const passMonths = getExamPassMonths(now);
  const highlightKey =
    highlight && (ALLOWANCE_KEYS as readonly string[]).includes(highlight) ? highlight : null;
  const reason = highlightKey && current ? describeUpgradeFor(current, highlightKey) : null;
  const bestSaving = Math.max(
    getExamPassQuote("plus", now).discountPercent,
    getExamPassQuote("pro", now).discountPercent
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      {checkoutSucceeded ? (
        <div role="status" className="app-subtle-panel rounded-xl px-4 py-3 text-sm text-text-primary">
          Thank you. Your plan is being set up and will show here in a moment.
        </div>
      ) : null}

      {lifetime ? (
        <Card tone="warm" padding="lg">
          <h2 className="text-lg font-medium text-text-primary">You have Lifetime access</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
            You joined Jami before plans existed, so it stays free for you, for good, with nothing
            counted month to month. The plans below are what new students choose from.
          </p>
        </Card>
      ) : null}

      <Card tone="warm" padding="lg">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,var(--color-accent-muted)_0%,transparent_55%)]"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-xl">
            <h2 className="text-2xl font-medium leading-tight tracking-tight text-text-primary [text-wrap:balance] sm:text-3xl">
              {reason && highlightKey
                ? `Want more ${ROW_LABELS[highlightKey] ?? ALLOWANCE_LABELS[highlightKey]}?`
                : "Choose how much Jami you need"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-text-muted sm:text-base sm:leading-7">
              {reason
                ? `${reason} Free keeps working, and your allowances come back every month.`
                : "Flashcards, notebooks and your planner are free on every plan. Plans add more of what Jami writes and marks for you."}
            </p>
          </div>
          <div className="w-full min-w-0 lg:w-[30rem] lg:shrink-0">
            <OptionSwitch
              label="How to pay"
              hideLabel
              value={kind}
              onChange={setKind}
              options={[
                { value: "subscription", label: "Monthly", detail: "Cancel any time" },
                {
                  value: "pass",
                  label: "Exam Pass",
                  detail: `Pay once to July · up to ${bestSaving}% off`,
                },
              ]}
              columns={2}
              className="w-full"
            />
          </div>
        </div>
      </Card>

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        {(["free", "plus", "pro"] as const).map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            kind={kind}
            now={now}
            passUntil={passUntil}
            passMonths={passMonths}
            current={current === plan}
            disabled={lifetime}
            highlight={highlightKey}
            onChoose={(paid) => setBuying({ plan: paid, forParent: false })}
          />
        ))}
      </div>

      <section
        aria-label="Free on every plan"
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
          Free on every plan
        </span>
        <ul className="flex flex-wrap gap-2">
          {ALWAYS_FREE.map((item) => (
            <li key={item} className="app-chip rounded-full px-3 py-1 text-xs font-medium">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <Card padding="lg">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 max-w-xl gap-4">
            <IconBubble size="lg" shape="circle" className="border border-warm-border bg-warm-glow text-warm-accent" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
                <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
              </svg>
            </IconBubble>
            <div className="min-w-0">
              <h2 className="text-base font-medium text-text-primary">Ask a parent to pay</h2>
              <p className="mt-1.5 text-sm leading-6 text-text-muted">
                Make a payment link and send it. They pay on their own phone or computer, and the
                plan lands on your account. They only see the plan and the price.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              disabled={lifetime}
              onClick={() => setBuying({ plan: "plus", forParent: true })}
            >
              Link for Plus
            </Button>
            <Button
              variant="secondary"
              disabled={lifetime}
              onClick={() => setBuying({ plan: "pro", forParent: true })}
            >
              Link for Pro
            </Button>
          </div>
        </div>
      </Card>

      <details className="app-subtle-panel group rounded-xl">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-text-primary">
          Compare everything
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 text-text-muted transition group-open:rotate-180" fill="currentColor">
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
          </svg>
        </summary>
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="text-2xs uppercase tracking-[0.14em] text-text-secondary">
                <th className="py-2 pr-4 font-semibold">Each month</th>
                <th className="py-2 pr-4 font-semibold">Free</th>
                <th className="py-2 pr-4 font-semibold">Plus</th>
                <th className="py-2 font-semibold">Pro</th>
              </tr>
            </thead>
            <tbody>
              {getPlanComparisonRows().map((row) => (
                <tr key={row.key} className="border-t border-[var(--color-border)]">
                  <td className="py-2.5 pr-4 text-text-primary">{row.label}</td>
                  <td className="py-2.5 pr-4 text-text-muted">{row.free}</td>
                  <td className="py-2.5 pr-4 text-text-muted">{row.plus}</td>
                  <td className="py-2.5 text-text-muted">{row.pro}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--color-border)]">
                <td className="py-2.5 pr-4 text-text-primary">Flashcards, notebooks, folders, planner</td>
                <td className="py-2.5 pr-4 text-text-muted">Unlimited</td>
                <td className="py-2.5 pr-4 text-text-muted">Unlimited</td>
                <td className="py-2.5 text-text-muted">Unlimited</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs text-text-muted">An Exam Pass gives the same each month, until {passUntil}.</p>
        </div>
      </details>

      <p className="text-xs leading-5 text-text-muted">
        UK cards only. Prices are the whole price. Plans renew monthly until you cancel, and
        cancelling keeps your plan until the end of the month you paid for. Exam Passes last until{" "}
        {passUntil} and never renew. Everyone who joined before plans has Lifetime access and never pays.
      </p>

      {buying ? (
        // Keyed so each purchase opens with the waiver unticked and no old link.
        <CheckoutDialog
          key={`${buying.plan}:${buying.forParent}:${kind}`}
          buying={buying}
          kind={kind}
          now={now}
          passUntil={passUntil}
          onClose={() => setBuying(null)}
        />
      ) : null}
    </div>
  );
}

/** A small planet: a moon for Free, one ring for Plus, two for Pro. */
function PlanGlyph({ plan }: { plan: ShownPlan }) {
  return (
    <IconBubble size="md" shape="circle" className={PLAN_STYLE[plan].glyph} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none" />
        {plan === "free" ? <circle cx="18.5" cy="7" r="1.4" fill="currentColor" stroke="none" /> : null}
        {plan !== "free" ? <ellipse cx="12" cy="12" rx="8.6" ry="3.2" transform="rotate(-22 12 12)" /> : null}
        {plan === "pro" ? <ellipse cx="12" cy="12" rx="10.4" ry="4.6" transform="rotate(28 12 12)" opacity="0.6" /> : null}
      </svg>
    </IconBubble>
  );
}

function PlanCard({
  plan,
  kind,
  now,
  passUntil,
  passMonths,
  current,
  disabled,
  highlight,
  onChoose,
}: {
  plan: ShownPlan;
  kind: CheckoutKind;
  now: number;
  passUntil: string;
  passMonths: number;
  current: boolean;
  disabled: boolean;
  highlight: AllowanceKey | null;
  onChoose: (plan: PaidPlanId) => void;
}) {
  const paid = plan === "free" ? null : plan;
  const featured = plan === "plus";
  const pass = kind === "pass";
  const quote = paid ? getExamPassQuote(paid, now) : null;
  const style = PLAN_STYLE[plan];
  const rows =
    highlight && !CARD_ROWS.includes(highlight) && !HEADLINE_ROWS.includes(highlight)
      ? [highlight, ...CARD_ROWS]
      : CARD_ROWS;

  const amount = (key: AllowanceKey) => {
    // Free has no pass, so it keeps its monthly numbers either way.
    if (!pass || !paid) {
      const value = describePlanAllowance(plan, key);
      return { main: value.replace(" a month", ""), aside: null as string | null };
    }
    const value = describePassAllowance(plan, key, passMonths);
    return { main: value.total, aside: value.perMonth };
  };

  return (
    <section
      aria-label={`${PLAN_LABELS[plan]} plan`}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-3xl border-[1.5px] bg-[var(--color-surface-panel)] p-5 shadow-bubble backdrop-blur-md sm:p-6 ${style.card}`}
    >
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${style.wash}`} />
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <PlanGlyph plan={plan} />
            <h2 className="text-xl font-medium tracking-tight text-text-primary">{PLAN_LABELS[plan]}</h2>
          </div>
          {current ? (
            <span className="app-chip rounded-full px-2.5 py-0.5 text-2xs font-semibold">Your plan</span>
          ) : featured ? (
            <span className="rounded-full bg-accent-muted px-2.5 py-0.5 text-2xs font-semibold text-accent">
              Most students
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-text-muted">{TAGLINES[plan]}</p>

        <div className="mt-5 min-h-[4.75rem]">
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-semibold tracking-tight text-text-primary tabular-nums">
              {!paid ? "£0" : pass && quote ? pounds(quote.perMonthPence) : pounds(PLAN_PRICES_PENCE[paid])}
            </span>
            <span className="text-sm text-text-muted">{paid ? "a month" : "for good"}</span>
          </div>
          {paid && pass && quote ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              <span>
                {pounds(quote.pricePence)} once · {quote.months} {quote.months === 1 ? "month" : "months"}
              </span>
              <span className="rounded-full bg-[var(--color-success-muted)] px-2 py-0.5 font-semibold text-text-primary">
                Save {pounds(quote.savingPence)}
              </span>
            </div>
          ) : paid ? (
            <div className="mt-1.5 text-xs text-text-muted">Renews monthly. Cancel any time.</div>
          ) : (
            <div className="mt-1.5 text-xs text-text-muted">No card needed.</div>
          )}
        </div>

        <div className="mt-5 text-2xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
          {pass && paid ? `Until ${passUntil}` : "Each month"}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {HEADLINE_ROWS.map((key) => {
            const { main, aside } = amount(key);
            const emphasised = key === highlight;
            return (
              <div
                key={key}
                className={`min-w-0 rounded-2xl border px-3 py-2.5 ${
                  emphasised
                    ? "border-accent bg-accent-muted"
                    : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
                }`}
              >
                <div className="text-2xl font-semibold tracking-tight text-text-primary tabular-nums">
                  {main}
                </div>
                <div className="text-xs text-text-secondary">{rowLabel(key)}</div>
                {pass && paid && aside ? <div className="text-2xs text-text-muted">{aside}</div> : null}
              </div>
            );
          })}
        </div>

        <ul className="mt-4 space-y-2.5 text-sm">
          {rows.map((key) => {
            const { main, aside } = amount(key);
            const emphasised = key === highlight;
            const muted = main === "Not included";
            return (
              <li
                key={key}
                className={`flex min-w-0 items-baseline justify-between gap-3 ${
                  emphasised ? "-mx-2 rounded-lg bg-accent-muted px-2 py-1" : ""
                }`}
              >
                <span className={`min-w-0 ${emphasised ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                  {rowLabel(key)}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className={muted ? "text-text-muted" : "text-text-primary"}>{main}</span>
                  {pass && paid && aside ? (
                    <span className="text-2xs text-text-muted"> · {aside}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-text-muted">
          {plan === "free"
            ? "Flashcards, notebooks and the planner are unlimited."
            : "Everything else is unlimited for normal studying."}
        </p>

        <div className="mt-auto pt-6">
          {!paid ? (
            <Button variant="ghost" disabled className="w-full justify-center">
              {current ? "Your plan" : "Free forever"}
            </Button>
          ) : (
            <Button
              variant={featured ? "primary" : "secondary"}
              disabled={disabled || (current && !pass)}
              className="w-full justify-center"
              onClick={() => onChoose(paid)}
            >
              {current && !pass
                ? "Your plan"
                : pass
                  ? `Get ${PLAN_LABELS[paid]} to July`
                  : `Choose ${PLAN_LABELS[paid]}`}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function CheckoutDialog({
  buying,
  kind,
  now,
  passUntil,
  onClose,
}: {
  buying: { plan: PaidPlanId; forParent: boolean };
  kind: CheckoutKind;
  now: number;
  passUntil: string;
  onClose: () => void;
}) {
  const [waiver, setWaiver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentLink, setParentLink] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const label = PLAN_LABELS[buying.plan];
  const price =
    kind === "subscription"
      ? `${pounds(PLAN_PRICES_PENCE[buying.plan])} a month, renewing monthly until cancelled`
      : `${pounds(getExamPassPricePence(buying.plan, now))} once, lasting until ${passUntil}`;

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await startCheckout({
        plan: buying.plan,
        kind,
        waiverAccepted: waiver,
        forParent: buying.forParent,
      });
      if (buying.forParent) {
        setParentLink(url);
      } else {
        window.location.assign(url);
      }
    } catch (reason) {
      setError(
        reason instanceof CheckoutError ? reason.message : "Payments are unavailable right now. Try again shortly."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      dismissible={!busy}
      initialFocusRef={cancelRef}
      className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center"
      onDismiss={onClose}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative w-full max-w-md rounded-2xl p-5 shadow-e3 sm:p-6">
        <DialogTitle className="text-lg font-semibold text-text-primary">
          {buying.forParent ? `A payment link for ${label}` : `Jami ${label}${kind === "pass" ? " Exam Pass" : ""}`}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-text-secondary">{price}.</DialogDescription>

        {parentLink ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-text-muted">Send this to whoever is paying. It works for 24 hours.</p>
            <input
              readOnly
              value={parentLink}
              className="app-subtle-panel w-full rounded-lg px-3 py-2 text-xs text-text-primary"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              className="w-full justify-center"
              onClick={() => void navigator.clipboard?.writeText(parentLink)}
            >
              Copy link
            </Button>
          </div>
        ) : (
          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6 text-text-primary">
            <input
              type="checkbox"
              checked={waiver}
              onChange={(event) => setWaiver(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span>{CHECKOUT_WAIVER_TEXT}</span>
          </label>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-warm-accent">
            {error}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onClose}>
            {parentLink ? "Done" : "Cancel"}
          </Button>
          {parentLink ? null : (
            <Button disabled={!waiver || busy} onClick={() => void proceed()}>
              {busy ? "Opening…" : buying.forParent ? "Make link" : "Continue to payment"}
            </Button>
          )}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
