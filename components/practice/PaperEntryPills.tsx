import Link from "next/link";
import { JamiTutorIcon } from "@/components/ui";

export const pillBase =
  "group inline-flex min-h-[2.25rem] items-center gap-2 rounded-full border text-sm font-medium shadow-e1 transition duration-fast ease-spring hover:-translate-y-px active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

export const neutralPill =
  "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] hover:text-text-primary";

export function Chevron({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M7.5 5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Real past paper questions -- the accented entry, since it starts practice. */
export function ExamQuestionsPill({
  href = "/dashboard/practice/questions/new",
}: {
  href?: string;
}) {
  return (
    <Link
      href={href}
      data-tutorial-target="exam-questions"
      className={`${pillBase} border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[var(--color-accent-muted)] pl-3.5 pr-2.5 text-text-primary hover:border-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_28%,transparent)]`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4 text-[var(--color-accent)]"
      >
        <path d="M7 3.75h7.5L19 8.25v12H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2z" />
        <path d="M14.5 3.75v4.5H19M9 12.5h6M9 16h4" />
      </svg>
      Exam questions
      <Chevron className="h-3.5 w-3.5 text-text-secondary transition duration-fast group-hover:translate-x-0.5 group-hover:text-text-primary" />
    </Link>
  );
}

export function HistoryPill({
  href = "/dashboard/practice/history",
}: {
  href?: string;
}) {
  return (
    <Link href={href} className={`${pillBase} ${neutralPill} px-3.5`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <circle cx="12" cy="12" r="8.25" />
        <path d="M12 7.75V12l2.75 1.75" />
      </svg>
      History
    </Link>
  );
}

/** A practice paper Jami builds, with Jami's mark in its bubble. */
export function PracticePaperPill({
  href = "/dashboard/practice/new",
}: {
  href?: string;
}) {
  return (
    <Link href={href} className={`${pillBase} ${neutralPill} pl-1.5 pr-2.5`}>
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
        <JamiTutorIcon className="h-4 w-4" />
      </span>
      Practice paper
      <Chevron className="h-3.5 w-3.5 transition duration-fast group-hover:translate-x-0.5" />
    </Link>
  );
}
