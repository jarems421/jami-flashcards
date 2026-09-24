"use client";

import { Button, DateField, Input, Select } from "@/components/ui";
import { MAX_PLAN_EXAMS, MAX_PLAN_EXAM_LABEL_LENGTH, unusedPlanExamId } from "@/lib/planning/normalize-plan";
import type { RevisionPlanExam } from "@/lib/planning/types";

/**
 * The exams a plan counts down to: a name, a date, and which subject, if the
 * student wants to say. Optional -- a plan with no exams counts down to its
 * own finish instead.
 */

export default function PlanExamsEditor({
  exams,
  subjects,
  defaultDayKey,
  onChange,
}: {
  exams: readonly RevisionPlanExam[];
  subjects: readonly { key: string; label: string }[];
  /** Where a new exam's date starts: the plan's finish is the usual answer. */
  defaultDayKey: string;
  onChange: (exams: RevisionPlanExam[]) => void;
}) {
  const update = (index: number, patch: Partial<RevisionPlanExam>) =>
    onChange(exams.map((exam, position) => (position === index ? { ...exam, ...patch } : exam)));

  return (
    <div className="space-y-3">
      {exams.map((exam, index) => (
        <div
          key={exam.id}
          className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <Input
            label="Exam"
            value={exam.label}
            maxLength={MAX_PLAN_EXAM_LABEL_LENGTH}
            placeholder="Chemistry Paper 1"
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <DateField label="Date" value={exam.dayKey} onValueChange={(dayKey) => update(index, { dayKey })} />
          <Select
            label="Subject"
            value={exam.scopeKey ?? ""}
            onChange={(event) => {
              const scopeKey = event.target.value;
              // "Not one subject" has to take the key away, not leave an empty one behind.
              const unscoped: RevisionPlanExam = { id: exam.id, label: exam.label, dayKey: exam.dayKey };
              onChange(
                exams.map((item, position) =>
                  position === index ? (scopeKey ? { ...unscoped, scopeKey } : unscoped) : item
                )
              );
            }}
          >
            <option value="">Not one subject</option>
            {subjects.map((subject) => (
              <option key={subject.key} value={subject.key}>
                {subject.label}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Remove ${exam.label || "this exam"}`}
            onClick={() => onChange(exams.filter((_, position) => position !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      {exams.length < MAX_PLAN_EXAMS ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange([...exams, { id: unusedPlanExamId(exams), label: "", dayKey: defaultDayKey }])
          }
        >
          Add an exam
        </Button>
      ) : null}
    </div>
  );
}
