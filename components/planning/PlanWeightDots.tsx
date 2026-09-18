/**
 * How much of the week a subject takes, as one to three dots.
 *
 * Shared by the builder, where they are a control, and the live preview, where
 * they are a reading. A number out of three would be exact and would invite the
 * student to think it means hours; the weighting is relative, and dots say that
 * without saying anything false.
 */
export default function PlanWeightDots({ weight }: { weight: number }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={`h-1.5 w-1.5 rounded-full transition duration-fast ${
            step <= weight ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"
          }`}
        />
      ))}
    </span>
  );
}
