"use client";

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
}: {
  allowance: AllowanceKey;
  mode: AllowanceHintMode;
  className?: string;
}) {
  const hint = useAllowanceHint(allowance, mode);
  if (!hint) return null;
  const out = hint.startsWith("No ");
  return (
    <p
      role="status"
      data-allowance-hint={allowance}
      className={`text-xs tabular-nums leading-5 ${out ? "text-warm-accent" : "text-text-muted"} ${className}`}
    >
      {hint}
    </p>
  );
}
