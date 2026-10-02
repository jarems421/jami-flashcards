"use client";

import Link from "next/link";
import type { AllowanceHintMode } from "@/lib/billing/hints";
import type { AllowanceKey } from "@/lib/billing/plans";
import { useAllowanceHint } from "@/hooks/useAllowanceHint";

/**
 * One quiet line about an allowance, placed beside the action that spends it.
 * Renders nothing at all unless there is something worth saying.
 */
export default function AllowanceHint({
  allowance,
  mode,
  className = "",
  offerPlans = true,
}: {
  allowance: AllowanceKey;
  mode: AllowanceHintMode;
  className?: string;
  /** False where a link would pull a student out of focused work, like a timed exam. */
  offerPlans?: boolean;
}) {
  const hint = useAllowanceHint(allowance, mode);
  if (!hint) return null;
  const out = hint.text.startsWith("No ");
  const plansHref = offerPlans ? hint.plansHref : null;
  return (
    <p
      role="status"
      data-allowance-hint={allowance}
      className={`text-xs tabular-nums leading-5 ${out ? "text-warm-accent" : "text-text-muted"} ${className}`}
    >
      {hint.text}
      {plansHref ? (
        <>
          {" · "}
          <Link
            href={plansHref}
            className="font-semibold text-text-secondary underline decoration-current/30 underline-offset-4 hover:text-text-primary"
          >
            See plans
          </Link>
        </>
      ) : null}
    </p>
  );
}
