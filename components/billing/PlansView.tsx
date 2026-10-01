"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, OptionSwitch } from "@/components/ui";
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
  EXAM_PASS_DISCOUNT,
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
  describePlanAllowance,
  describeUpgradeFor,
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
 */

const CARD_ROWS: AllowanceKey[] = ["papers", "answers", "tutor", "searches", "photos", "videos"];

const TAGLINES: Record<Exclude<PlanId, "lifetime">, string> = {
  free: "Try everything, with small monthly amounts.",
  plus: "For steady revision across your subjects.",
  pro: "For heavy exam prep and lots of papers.",
};

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function capitalise(text: string) {
  return text.length ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
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
  const reason = highlight && current ? describeUpgradeFor(current, highlight) : null;
  const highlightLabel =
    highlight && (ALLOWANCE_KEYS as readonly string[]).includes(highlight) ? highlight : null;

  return (
    <div className="space-y-6">
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

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className={`max-w-xl text-sm leading-6 ${reason ? "text-text-primary" : "text-text-muted"}`}>
          {reason ?? "Pick what fits your revision. You can change plan or cancel any time in Account."}
        </p>
        <OptionSwitch
          label="How to pay"
          hideLabel
          value={kind}
          onChange={setKind}
          options={[
            { value: "subscription", label: "Monthly" },
            { value: "pass", label: "Exam Pass" },
          ]}
          columns={2}
          className="w-full md:w-[30rem]"
        />
      </div>
      {kind === "pass" ? (
        <p className="-mt-3 text-xs leading-5 text-text-muted">
          One payment, lasting until {passUntil} ({passMonths} {passMonths === 1 ? "month" : "months"}).
          It never renews and needs no cancelling.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {(["free", "plus", "pro"] as const).map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            kind={kind}
            now={now}
            current={current === plan}
            disabled={lifetime}
            highlight={highlightLabel}
            onChoose={(paid) => setBuying({ plan: paid, forParent: false })}
          />
        ))}
      </div>

      <Card padding="lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-base font-medium text-text-primary">Ask a parent to pay</h2>
            <p className="mt-1.5 text-sm leading-6 text-text-muted">
              Make a payment link and send it. They pay on their own phone or computer, and the plan
              lands on your account. They only see the plan and the price.
            </p>
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
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-text-primary">
          Compare everything
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

function PlanCard({
  plan,
  kind,
  now,
  current,
  disabled,
  highlight,
  onChoose,
}: {
  plan: Exclude<PlanId, "lifetime">;
  kind: CheckoutKind;
  now: number;
  current: boolean;
  disabled: boolean;
  highlight: AllowanceKey | null;
  onChoose: (plan: PaidPlanId) => void;
}) {
  const paid = plan === "free" ? null : plan;
  const featured = plan === "plus";
  const passPrice = paid ? getExamPassPricePence(paid, now) : 0;
  const passMonthly = paid ? passPrice / getExamPassMonths(now) : 0;
  const rows = highlight && !CARD_ROWS.includes(highlight) ? [highlight, ...CARD_ROWS] : CARD_ROWS;

  return (
    <section
      aria-label={`${PLAN_LABELS[plan]} plan`}
      className={`relative flex min-w-0 flex-col rounded-2xl border p-5 sm:p-6 ${
        featured
          ? "border-accent bg-[var(--color-surface-panel-strong)] shadow-accent"
          : "border-[var(--color-border)] bg-[var(--color-surface-panel)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-text-primary">{PLAN_LABELS[plan]}</h2>
        {current ? (
          <span className="app-chip rounded-full px-2.5 py-0.5 text-2xs font-semibold">Your plan</span>
        ) : featured ? (
          <span className="rounded-full bg-accent-muted px-2.5 py-0.5 text-2xs font-semibold text-accent">
            Most students
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-text-muted">{TAGLINES[plan]}</p>

      <div className="mt-5">
        {!paid ? (
          <div className="text-3xl font-semibold tracking-tight text-text-primary">£0</div>
        ) : kind === "subscription" ? (
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tracking-tight text-text-primary">
              {pounds(PLAN_PRICES_PENCE[paid])}
            </span>
            <span className="text-sm text-text-muted">a month</span>
          </div>
        ) : (
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-tight text-text-primary">
                {pounds(passPrice)}
              </span>
              <span className="text-sm text-text-muted">once</span>
            </div>
            <div className="mt-1 text-xs text-text-muted">
              About {pounds(Math.round(passMonthly))} a month · {Math.round(EXAM_PASS_DISCOUNT[paid] * 100)}% off monthly
            </div>
          </div>
        )}
      </div>

      <ul className="mt-5 space-y-2.5 text-sm">
        {rows.map((key) => {
          const value = describePlanAllowance(plan, key);
          const label = PLAN_LABEL_FOR_ROW[key] ?? capitalise(key);
          const emphasised = key === highlight;
          return (
            <li
              key={key}
              className={`flex min-w-0 items-baseline justify-between gap-3 ${
                emphasised ? "-mx-2 rounded-lg bg-accent-muted px-2 py-1" : ""
              }`}
            >
              <span className={`min-w-0 ${emphasised ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                {label}
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  value === "Not included" ? "text-text-muted" : "text-text-primary"
                }`}
              >
                {value.replace(" a month", "")}
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
            disabled={disabled || (current && kind === "subscription")}
            className="w-full justify-center"
            onClick={() => onChoose(paid)}
          >
            {current && kind === "subscription"
              ? "Your plan"
              : kind === "pass"
                ? `Get ${PLAN_LABELS[paid]} Exam Pass`
                : `Choose ${PLAN_LABELS[paid]}`}
          </Button>
        )}
      </div>
    </section>
  );
}

const PLAN_LABEL_FOR_ROW: Partial<Record<AllowanceKey, string>> = {
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
