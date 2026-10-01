"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/Dialog";
import { featureFlags } from "@/lib/app/feature-flags";
import { describeUpgradeFor, shouldOfferPlans } from "@/lib/billing/upsell";
import type { PlanId } from "@/lib/billing/plans";
import {
  subscribeAllowanceRefusals,
  type AllowanceRefusal,
} from "@/services/billing/allowance-events";
import { loadPlanSummary } from "@/services/billing/plan-summary-store";

/**
 * The one place plans are offered unprompted: right after a student runs out
 * of something, once per allowance per session, and never on Pro (nothing to
 * move up to) or Lifetime. See `lib/billing/upsell.ts`.
 *
 * "Not now" is as prominent as "See plans" and closes it for good this
 * session; the feature's own inline message stays where it was.
 */
export default function AllowanceRefusalSheet() {
  const enabled = featureFlags.enableBilling;
  const [refusal, setRefusal] = useState<(AllowanceRefusal & { plan: PlanId }) | null>(null);
  const offered = useRef(new Set<string>());
  const notNowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!enabled) return;
    return subscribeAllowanceRefusals((next) => {
      void loadPlanSummary(true)
        .then((summary) => {
          const plan = summary.enabled ? summary.plan : null;
          if (!shouldOfferPlans({ plan, key: next.allowance, alreadyOffered: offered.current })) return;
          offered.current.add(next.allowance ?? "any");
          if (plan) setRefusal({ ...next, plan });
        })
        .catch(() => undefined);
    });
  }, [enabled]);

  const upgrade = refusal ? describeUpgradeFor(refusal.plan, refusal.allowance) : null;
  // "You've used this month's Jami papers. They reset on 14 November. …":
  // the first sentence is the title, the second (when the reset) the detail.
  const sentences = refusal?.message.split(/(?<=\.)\s+/) ?? [];
  const title = sentences[0]?.replace(/\.$/, "") || "Used up for this month";
  const detail = sentences[0]?.includes("come with") ? null : sentences[1] ?? null;
  const plansHref = refusal?.allowance
    ? `/dashboard/plans?for=${encodeURIComponent(refusal.allowance)}`
    : "/dashboard/plans";

  return (
    <Dialog
      open={refusal !== null}
      initialFocusRef={notNowRef}
      className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center"
      onDismiss={() => setRefusal(null)}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative w-full max-w-md rounded-2xl p-5 shadow-e3 sm:p-6">
        <DialogTitle className="text-lg font-semibold text-text-primary">
          {title}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-text-secondary">
          {detail}
          {upgrade ? (
            <>
              {" "}
              <span className="text-text-primary">{upgrade}</span>
            </>
          ) : null}
        </DialogDescription>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button ref={notNowRef} variant="secondary" onClick={() => setRefusal(null)}>
            Not now
          </Button>
          <ButtonLink href={plansHref} onClick={() => setRefusal(null)} className="justify-center">
            See plans
          </ButtonLink>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
