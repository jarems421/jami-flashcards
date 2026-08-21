"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";
import type { PracticePaper } from "@/lib/practice/practice-papers";

export default function PracticePaperDetailsDialog({
  open,
  paper,
  onClose,
}: {
  open: boolean;
  userId: string;
  paper: PracticePaper;
  onClose: () => void;
  onChange: (paper: PracticePaper) => void;
}) {
  return (
    <Dialog open={open} onDismiss={onClose}>
      <DialogBackdrop />
      <DialogPanel className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Paper details</DialogTitle>
        <DialogDescription>
          Check the assessment basis, structure and sources before beginning.
          Questions and the fixed marking guide are locked together once Jami
          finishes its quality checks.
        </DialogDescription>

        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border border-[var(--color-border)] p-4 sm:p-5">
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
              What you are about to sit
            </p>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-semibold tabular-nums text-text-primary">
                {paper.totalMarks}
              </span>
              <span className="text-sm font-medium text-text-secondary">marks</span>
              {paper.durationMinutes ? (
                <>
                  <span aria-hidden="true" className="text-text-muted">·</span>
                  <span className="text-3xl font-semibold tabular-nums text-text-primary">
                    {paper.durationMinutes}
                  </span>
                  <span className="text-sm font-medium text-text-secondary">minutes</span>
                </>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip>{paper.timingMode === "timed" ? "Timed" : "Untimed"}</Chip>
              <Chip>{paper.tutorEnabled ? "Tutor assisted" : "Exam conditions"}</Chip>
              <Chip>{paper.questions.length} questions</Chip>
            </div>
            {paper.choiceGroups.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs leading-5 text-text-muted">
                {paper.choiceGroups.map((group) => (
                  <li key={group.id}>
                    <span className="font-semibold text-text-secondary">{group.label}</span>
                    {` — ${group.requiredCount} of ${group.questionIds.length} count`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] p-4 sm:p-5">
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
              What it was built from
            </p>
            <dl className="mt-3 divide-y divide-[var(--color-border)]">
              <Detail label="Course or module" value={paper.assessmentProfile.qualificationOrModule} />
              <Detail
                label="Specification"
                value={[
                  paper.assessmentProfile.awardingBodyOrInstitution,
                  paper.assessmentProfile.specificationOrCourse,
                  paper.assessmentProfile.tierOrComponent,
                ].filter(Boolean).join(" · ") || paper.assessmentProfile.studyLevel}
              />
              <Detail
                label="Marking basis"
                value={paper.markScheme.label}
                note={paper.markScheme.notice}
              />
              {paper.assessmentProfile.formatSummary ? (
                <Detail label="Format Jami followed" value={paper.assessmentProfile.formatSummary} />
              ) : null}
            </dl>
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-medium text-text-secondary">Sources that shaped this paper</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {paper.sourceLabels.length > 0
                  ? paper.sourceLabels.map((label) => <Chip key={label}>{label}</Chip>)
                  : <span className="text-sm text-text-muted">No folder sources were required.</span>}
              </div>
            </div>
          </div>

          {paper.companionDocuments && paper.companionDocuments.length > 0 ? (
            <div className="rounded-2xl border border-[var(--color-border)] p-4 sm:p-5">
              <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Candidate materials
              </p>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                These inserts are visible during the sitting and remain separate from the hidden marking guide.
              </p>
              <div className="mt-3 space-y-2">
                {paper.companionDocuments.map((document) => (
                  <details key={document.id} className="rounded-xl bg-[var(--color-glass-subtle)] p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-text-primary">
                      {document.title}
                    </summary>
                    {document.instructions ? <p className="mt-2 text-xs leading-5 text-text-muted">{document.instructions}</p> : null}
                    <div className="mt-3 space-y-3">
                      {document.pages.map((page) => (
                        <div key={page.id} className="rounded-lg bg-[var(--color-surface)] p-3">
                          {page.title ? <p className="text-xs font-semibold text-text-secondary">{page.title}</p> : null}
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-primary">{page.content}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}

          {paper.examinerInsights.length > 0 ? (
            <div className="rounded-2xl bg-[var(--color-glass-subtle)] p-4 sm:p-5">
              <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                Examiner-informed focus
              </p>
              <ul className="mt-2.5 space-y-1.5 text-sm leading-6 text-text-secondary">
                {paper.examinerInsights.map((insight) => <li key={insight}>• {insight}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--color-glass-medium)] px-2.5 py-1 text-xs font-medium text-text-secondary">
      {children}
    </span>
  );
}

function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="text-sm text-text-primary">
        {value || "Not confirmed"}
        {note ? <span className="mt-1 block text-xs leading-5 text-text-muted">{note}</span> : null}
      </dd>
    </div>
  );
}
