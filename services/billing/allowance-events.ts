import { ALLOWANCE_KEYS, type AllowanceKey } from "@/lib/billing/plans";

/**
 * "A student just ran out of something", from wherever it happened.
 *
 * Each AI feature reads its own refusals; this lets them all reach the one
 * sheet that offers plans (`AllowanceRefusalSheet`) without each knowing it
 * exists. The feature still shows its own inline message either way.
 */

const EVENT = "jami:allowance-used";

export type AllowanceRefusal = { allowance: AllowanceKey | null; message: string };

function asAllowanceKey(value: unknown): AllowanceKey | null {
  return typeof value === "string" && (ALLOWANCE_KEYS as readonly string[]).includes(value)
    ? (value as AllowanceKey)
    : null;
}

/**
 * Reports a refusal if the response body was one. Returns whether it was, so
 * a caller can use it in a condition. Safe to call with anything.
 */
export function reportAllowanceRefusal(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  if (record.code !== "allowance_used") return false;
  if (typeof window === "undefined") return true;
  const detail: AllowanceRefusal = {
    allowance: asAllowanceKey(record.allowance),
    message: typeof record.error === "string" ? record.error : "You've used this month's allowance for this.",
  };
  window.dispatchEvent(new CustomEvent<AllowanceRefusal>(EVENT, { detail }));
  return true;
}

export function subscribeAllowanceRefusals(listener: (refusal: AllowanceRefusal) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<AllowanceRefusal>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
