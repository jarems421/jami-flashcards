"use client";

import { useEffect, useState } from "react";
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
            <div className="space-y-3">
              {draft.questions.map((question, index) => {
                const schemeIndex = draft.markScheme.items.findIndex((item) => item.questionId === question.id);
                const scheme = draft.markScheme.items[schemeIndex];
                return (
                  <div key={question.id} className="rounded-xl border border-[var(--color-border)] p-4">
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
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Course or module" value={paper.assessmentProfile.qualificationOrModule} />
              <Detail label="Attempt" value={`${paper.totalMarks} marks${paper.durationMinutes ? ` · ${paper.durationMinutes} minutes` : ""}`} />
              <Detail label="Specification" value={[paper.assessmentProfile.awardingBodyOrInstitution, paper.assessmentProfile.specificationOrCourse, paper.assessmentProfile.tierOrComponent].filter(Boolean).join(" · ") || paper.assessmentProfile.studyLevel} />
              <Detail label="Marking basis" value={paper.markScheme.label} note={paper.markScheme.notice} />
            </div>
            {paper.assessmentProfile.formatSummary ? <Detail label="Format Jami followed" value={paper.assessmentProfile.formatSummary} /> : null}
            {paper.choiceGroups.map((group) => (
              <Detail key={group.id} label="Optional-question rule" value={`${group.label} · ${group.requiredCount} of ${group.questionIds.length} count`} />
            ))}
            {paper.examinerInsights.length > 0 ? (
              <div className="rounded-xl bg-[var(--color-glass-subtle)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Examiner-informed focus</p>
                <ul className="mt-2 space-y-1.5 text-sm text-text-secondary">
                  {paper.examinerInsights.map((insight) => <li key={insight}>· {insight}</li>)}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Sources that shaped this paper</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {paper.sourceLabels.length > 0
                  ? paper.sourceLabels.map((label) => <span key={label} className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-text-secondary">{label}</span>)
                  : <span className="text-sm text-text-muted">No folder sources were required.</span>}
              </div>
            </div>
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

function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{label}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-text-primary">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-text-muted">{note}</p> : null}
    </div>
  );
}
