import { AiAbortError } from "@/lib/ai/abort";
import { PracticePaperMarkingFailedError } from "@/lib/practice/marker-stages";

/**
 * What kind of failure stopped a marking, never what it said.
 *
 * A message can carry the student's answer or a provider's payload, so none is
 * kept. But recording nothing at all hid a production outage: every marking
 * from 18 to 24 September failed as the same content-free "failed", and the
 * cause -- the supervisor pinned to a retired model the approved endpoints
 * refused with HTTP 404 -- had to be recovered from request logs. A status
 * code, an abort kind or one of the job's own error codes says which of those
 * it was and carries nothing a student wrote.
 */
export function markingFailureCause(error: unknown): string {
  if (error instanceof AiAbortError) return `abort_${error.kind}`;
  const status =
    error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  if (status !== undefined) return `provider_http_${status}`;
  if (error instanceof PracticePaperMarkingFailedError) return "invalid_report";
  // The job's own codes are identifiers ("scheme_mismatch", "missing_question_result"); anything with a space is prose.
  if (error instanceof Error && /^[a-z][a-z_]{2,40}$/.test(error.message)) return error.message;
  if (error instanceof Error && error.name !== "Error" && /^[A-Za-z]{2,40}$/.test(error.name)) return `exception_${error.name}`;
  return "unknown";
}

/** Private, content-free accounting. An unknown bill is never recorded as zero. */
export function failedMarkingExecution(error: unknown) {
  const cause = markingFailureCause(error);
  return error instanceof PracticePaperMarkingFailedError
    ? { status: "failed", cause, costAccounting: error.costAccounting, billingKnown: error.billingKnown }
    : { status: "failed", cause, billingKnown: false };
}
