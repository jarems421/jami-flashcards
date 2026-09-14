import Link from "next/link";
import { type ReactNode } from "react";
import { JamiTutorIcon } from "@/components/ui";
import { ExamQuestionsPill, HistoryPill } from "./PaperEntryPills";

function EntryRow({
  href,
  icon,
  title,
  detail,
  className = "",
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-w-0 items-center gap-3 px-4 py-3 transition duration-fast hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 ${className}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-muted)] text-[var(--color-accent)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-5 text-text-primary">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-text-muted">
          {detail}
        </span>
      </span>
      {/* A button-shaped arrow, so the row reads as something to press. */}
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary transition duration-fast group-hover:border-transparent group-hover:bg-[var(--color-accent)] group-hover:text-[var(--color-text-inverse)]">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="h-4 w-4 transition duration-fast group-hover:translate-x-0.5"
        >
          <path
            d="M7.5 5l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Link>
  );
}

function BuildPaperRow({ className }: { className?: string }) {
  return (
    <EntryRow
      href="/dashboard/practice/new"
      icon={<JamiTutorIcon className="h-5 w-5" />}
      title="Practice paper"
      detail="Built from your folder"
      className={className}
    />
  );
}

/**
 * Practice's paper entry points in one place: real past paper questions, and
 * a practice paper Jami builds. Building a paper does not depend on the past
 * paper corpus, so it stays when that feature is switched off.
 */
export default function PastPaperPracticeSection({
  pastPapersEnabled,
}: {
  pastPapersEnabled: boolean;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-medium tracking-tight text-text-primary sm:text-lg">
        {pastPapersEnabled ? "Past Paper Practice" : "Practice papers"}
      </h3>

      {pastPapersEnabled ? (
        <div className="app-subtle-panel grid overflow-hidden rounded-xl md:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <ExamQuestionsPill />
            <HistoryPill />
          </div>
          <BuildPaperRow className="border-t border-[var(--color-border)] md:border-l md:border-t-0" />
        </div>
      ) : (
        <div className="app-subtle-panel overflow-hidden rounded-xl md:max-w-sm">
          <BuildPaperRow />
        </div>
      )}
    </section>
  );
}
