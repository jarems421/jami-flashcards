import type { PasswordAssessment } from "@/lib/auth/password-strength";

type PasswordStrengthProps = {
  assessment: PasswordAssessment;
  /** A line under the meter: what is missing, or why it is good enough. */
  hint?: string | null;
  id?: string;
};

/**
 * How strong a new password is, for creating an account and for resetting one.
 *
 * Four segments rather than a bar, so the scale reads as a small number of
 * steps you can actually reach rather than a continuous score to be optimised
 * against. The segments stay empty until the password is acceptable at all, so
 * a short password never looks half-way there.
 */
export default function PasswordStrength({
  assessment,
  hint,
  id,
}: PasswordStrengthProps) {
  const fill =
    assessment.strength >= 3 ? "bg-[var(--color-success-mark)]" : "bg-[var(--color-warning-mark)]";

  return (
    <div id={id} className="mt-2.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3].map((segment) => (
            <span
              key={segment}
              className={`h-1 flex-1 rounded-full transition duration-normal ${
                assessment.acceptable && segment < assessment.strength
                  ? fill
                  : "bg-[var(--color-border)]"
              }`}
            />
          ))}
        </div>
        <span
          className={`shrink-0 text-2xs font-semibold uppercase tracking-[0.14em] ${
            assessment.acceptable ? "text-text-secondary" : "text-text-muted"
          }`}
        >
          {assessment.label}
        </span>
      </div>
      {hint ? (
        <p className="mt-2 text-xs leading-5 text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
