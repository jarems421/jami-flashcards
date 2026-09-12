import { PracticePaperMarkingFailedError } from "@/lib/practice/marker-stages";

/** Private, content-free accounting. An unknown bill is never recorded as zero. */
export function failedMarkingExecution(error: unknown) {
  return error instanceof PracticePaperMarkingFailedError
    ? { status: "failed", costAccounting: error.costAccounting, billingKnown: error.billingKnown }
    : { status: "failed", billingKnown: false };
}
