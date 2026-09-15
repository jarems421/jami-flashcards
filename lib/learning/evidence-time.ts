/**
 * The earliest time accepted as a real study timestamp.
 *
 * Anything before it is malformed rather than old: typically seconds stored
 * where milliseconds belong, which reads as January 1970 and would otherwise
 * be scored as ancient evidence instead of being recognised as broken.
 */
export const MIN_VALID_EVIDENCE_TIME = Date.UTC(2000, 0, 1);

export function isValidEvidenceTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_VALID_EVIDENCE_TIME;
}
