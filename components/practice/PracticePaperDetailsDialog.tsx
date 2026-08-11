"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
  Textarea,
} from "@/components/ui";
import type { PracticePaper } from "@/lib/practice/practice-papers";
import { updatePracticePaperDefinition } from "@/services/study/practice-papers";

export default function PracticePaperDetailsDialog({
  open,
  userId,
  paper,
  onClose,
  onChange,
}: {
  open: boolean;
  userId: string;
  paper: PracticePaper;
  onClose: () => void;
  onChange: (paper: PracticePaper) => void;
}) {
  const [draft, setDraft] = useState(paper);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canEdit = paper.status === "ready" && paper.attemptCount === 0;

  useEffect(() => {
    if (open) {
      setDraft(paper);
      setEditing(false);
      setError("");
    }
  }, [open, paper]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const questions = draft.questions.map((question) => ({
        ...question,
        marks: Math.max(1, Math.round(question.marks)),
      }));
      const marksById = new Map(questions.map((question) => [question.id, question.marks]));
      const markScheme = {
        ...draft.markScheme,
        items: draft.markScheme.items.map((item) => ({
          ...item,
          maxMarks: marksById.get(item.questionId) ?? item.maxMarks,
        })),
      };
      const updated = await updatePracticePaperDefinition({
        userId,
        paper,
        title: draft.title,
        durationMinutes: draft.durationMinutes,
        assessmentProfile: draft.assessmentProfile,
        questions,
        choiceGroups: draft.choiceGroups,
        markScheme,
      });
      onChange(updated);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this paper.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onDismiss={onClose}>
      <DialogBackdrop />
      <DialogPanel className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>{editing ? "Edit paper" : "Paper details"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes update the paper and fixed marking guide before the first attempt."
                : "Check the assessment basis, choices and sources before beginning."}
            </DialogDescription>
          </div>
          {canEdit && !editing ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit paper
            </Button>
          ) : null}
        </div>

        {error ? <p className="mt-4 rounded-xl bg-error/10 p-3 text-sm text-error">{error}</p> : null}

        {editing ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Paper title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              <Input label="Duration (minutes)" type="number" min={0} max={360} value={String(draft.durationMinutes)} onChange={(event) => setDraft({ ...draft, durationMinutes: Number(event.target.value) || 0 })} />
              <Input label="Course or module" value={draft.assessmentProfile.qualificationOrModule} onChange={(event) => setDraft({ ...draft, assessmentProfile: { ...draft.assessmentProfile, qualificationOrModule: event.target.value } })} />
              <Input label="Exam board or institution" value={draft.assessmentProfile.awardingBodyOrInstitution} onChange={(event) => setDraft({ ...draft, assessmentProfile: { ...draft.assessmentProfile, awardingBodyOrInstitution: event.target.value } })} />
              <Input label="Specification or course" value={draft.assessmentProfile.specificationOrCourse} onChange={(event) => setDraft({ ...draft, assessmentProfile: { ...draft.assessmentProfile, specificationOrCourse: event.target.value } })} />
              <Input label="Tier or component" value={draft.assessmentProfile.tierOrComponent} onChange={(event) => setDraft({ ...draft, assessmentProfile: { ...draft.assessmentProfile, tierOrComponent: event.target.value } })} />
            </div>
            <Textarea label="Assessment format" rows={3} value={draft.assessmentProfile.formatSummary} onChange={(event) => setDraft({ ...draft, assessmentProfile: { ...draft.assessmentProfile, formatSummary: event.target.value } })} />
            {/*
              * Editing marks without seeing the total was the gap here: the
              * questions were an undifferentiated stack of boxes, and the only
              * way to know whether they still added up to the paper was to add
              * them up yourself.
              */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--color-border)] pt-5">
              <h3 className="text-sm font-semibold text-text-primary">
                Questions
              </h3>
              <p className="text-xs tabular-nums text-text-muted">
                {draft.questions.length} question
                {draft.questions.length === 1 ? "" : "s"} ·{" "}
                <span className="font-semibold text-text-secondary">
                  {draft.questions.reduce(
                    (total, question) => total + Math.max(1, Math.round(question.marks)),
                    0
                  )}{" "}
                  marks
                </span>{" "}
                in total
              </p>
            </div>
            <div className="space-y-3">
              {draft.questions.map((question, index) => {
                const schemeIndex = draft.markScheme.items.findIndex((item) => item.questionId === question.id);
                const scheme = draft.markScheme.items[schemeIndex];
                return (
                  <div key={question.id} className="rounded-xl border border-[var(--color-border)] p-4">
                    <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                      Question {index + 1}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                      <Input label="Question label" value={question.label} onChange={(event) => setDraft({ ...draft, questions: draft.questions.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} />
                      <Input label="Marks" type="number" min={1} max={100} value={String(question.marks)} onChange={(event) => setDraft({ ...draft, questions: draft.questions.map((item, itemIndex) => itemIndex === index ? { ...item, marks: Number(event.target.value) || 1 } : item) })} />
                    </div>
                    <Textarea containerClassName="mt-3" label="Question" rows={3} value={question.prompt} onChange={(event) => setDraft({ ...draft, questions: draft.questions.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: event.target.value } : item) })} />
                    {scheme ? (
                      <>
                        <Textarea containerClassName="mt-3" label="Expected answer" rows={3} value={scheme.answer} onChange={(event) => setDraft({ ...draft, markScheme: { ...draft.markScheme, items: draft.markScheme.items.map((item, itemIndex) => itemIndex === schemeIndex ? { ...item, answer: event.target.value } : item) } })} />
                        <Textarea containerClassName="mt-3" label="Marking criteria (one per line)" rows={3} value={scheme.criteria.join("\n")} onChange={(event) => setDraft({ ...draft, markScheme: { ...draft.markScheme, items: draft.markScheme.items.map((item, itemIndex) => itemIndex === schemeIndex ? { ...item, criteria: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 30) } : item) } })} />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /*
           * Two questions, answered in that order: what am I about to sit, and
           * what was it built from. They used to be five identically weighted
           * bordered boxes in a grid -- a spec sheet where the marks and the
           * duration, the things you actually check before starting, sat at the
           * same size as the awarding body.
           */
          <div className="mt-5 space-y-5">
            <div className="rounded-2xl border border-[var(--color-border)] p-4 sm:p-5">
              <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                What you are about to sit
              </p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-semibold tracking-tight tabular-nums text-text-primary">
                  {paper.totalMarks}
                </span>
                <span className="text-sm font-medium text-text-secondary">
                  marks
                </span>
                {paper.durationMinutes ? (
                  <>
                    <span aria-hidden="true" className="text-text-muted">·</span>
                    <span className="text-3xl font-semibold tracking-tight tabular-nums text-text-primary">
                      {paper.durationMinutes}
                    </span>
                    <span className="text-sm font-medium text-text-secondary">
                      minutes
                    </span>
                  </>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip>{paper.timingMode === "timed" ? "Timed" : "Untimed"}</Chip>
                <Chip>
                  {paper.tutorEnabled
                    ? "Tutor available · attempt labelled Tutor-assisted"
                    : "Tutor off · exam conditions"}
                </Chip>
              </div>
              {paper.choiceGroups.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {paper.choiceGroups.map((group) => (
                    <li key={group.id} className="text-xs leading-5 text-text-muted">
                      <span className="font-semibold text-text-secondary">
                        {group.label}
                      </span>{" "}
                      — {group.requiredCount} of {group.questionIds.length} count
                      towards your mark
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
                <Detail
                  label="Course or module"
                  value={paper.assessmentProfile.qualificationOrModule}
                />
                <Detail
                  label="Specification"
                  value={
                    [
                      paper.assessmentProfile.awardingBodyOrInstitution,
                      paper.assessmentProfile.specificationOrCourse,
                      paper.assessmentProfile.tierOrComponent,
                    ]
                      .filter(Boolean)
                      .join(" · ") || paper.assessmentProfile.studyLevel
                  }
                />
                <Detail
                  label="Marking basis"
                  value={paper.markScheme.label}
                  note={paper.markScheme.notice}
                />
                {paper.assessmentProfile.formatSummary ? (
                  <Detail
                    label="Format Jami followed"
                    value={paper.assessmentProfile.formatSummary}
                  />
                ) : null}
              </dl>

              <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                <p className="text-xs font-medium text-text-secondary">
                  Sources that shaped this paper
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {paper.sourceLabels.length > 0 ? (
                    paper.sourceLabels.map((label) => (
                      <Chip key={label}>{label}</Chip>
                    ))
                  ) : (
                    <span className="text-sm text-text-muted">
                      No folder sources were required.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {paper.examinerInsights.length > 0 ? (
              <div className="rounded-2xl bg-[var(--color-glass-subtle)] p-4 sm:p-5">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Examiner-informed focus
                </p>
                <ul className="mt-2.5 space-y-1.5 text-sm leading-6 text-text-secondary">
                  {paper.examinerInsights.map((insight) => (
                    <li key={insight}>• {insight}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {paper.generationAudit ? (
              <p className="rounded-xl bg-accent/8 p-3 text-xs leading-5 text-text-muted">
                Quality checked by an independent AI reviewer
                {paper.generationAudit.issueCount > 0
                  ? ` · ${paper.generationAudit.issueCount} issue${paper.generationAudit.issueCount === 1 ? "" : "s"} found${paper.generationAudit.repaired ? " and repaired" : ""}`
                  : " · no structural issues found"}.
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {!editing ? (
            <Button type="button" variant="secondary" onClick={() => window.open(`/dashboard/practice/papers/${encodeURIComponent(paper.notebookId)}/print`, "_blank", "noopener,noreferrer")}>Print or save PDF</Button>
          ) : null}
          {editing ? (
            <>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save changes"}</Button>
            </>
          ) : (
            <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          )}
        </div>
      </DialogPanel>
    </Dialog>
  );
}

/** One fact about the paper: label left, value right, rule between rows. */
function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-xs leading-6 text-text-muted">{label}</dt>
      <dd className="min-w-0">
        <span className="block text-sm leading-6 text-text-primary">{value}</span>
        {note ? (
          <span className="mt-0.5 block text-xs leading-5 text-text-muted">{note}</span>
        ) : null}
      </dd>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-1.5 text-xs text-text-secondary">
      {children}
    </span>
  );
}
