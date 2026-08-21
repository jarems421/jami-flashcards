"use client";

import { useState } from "react";
import { Button, Input, JamiSparklesIcon } from "@/components/ui";
import type { PracticePaperBrief } from "@/lib/practice/exam-formats";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--color-glass-subtle)] px-3.5 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-text-primary" title={value}>
        {value}
      </dd>
    </div>
  );
}

export default function PracticePaperFormatConfirmation({
  brief,
  disabled,
  onConfirm,
  onUseCustom,
  onCorrect,
  onCancel,
}: {
  brief: PracticePaperBrief;
  disabled?: boolean;
  onConfirm: () => void;
  onUseCustom: () => void;
  onCorrect: (correction: string) => void;
  onCancel: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const verified = brief.verificationStatus === "verified";
  return (
    <section
      className="overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-br from-accent/10 via-[var(--color-surface)] to-[var(--color-glass-subtle)] shadow-sm"
      aria-labelledby="paper-format-title"
    >
      <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
          <JamiSparklesIcon className="size-4.5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">
            Paper format
          </p>
          <h2 id="paper-format-title" className="mt-1 text-lg font-semibold text-text-primary">
            {verified ? "Jami found the official format" : "Check Jami understood the right paper"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {verified
              ? "This structure was checked against official assessment material."
              : "The evidence did not settle every format detail, so confirm it before Jami continues."}
          </p>
        </div>
      </div>

      <dl className="grid gap-2 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
        <Fact label="Board" value={brief.board} />
        <Fact label="Course" value={`${brief.qualification} · ${brief.subject}`} />
        <Fact label="Component" value={brief.component} />
        <Fact label="Specification" value={brief.specification || "Not confirmed"} />
        <Fact label="Sitting" value={`${brief.durationMinutes || "—"} min · ${brief.totalMarks || "—"} marks`} />
        <Fact label="Materials" value={brief.materials.length ? brief.materials.join(", ") : "No separate insert identified"} />
      </dl>

      {correcting ? (
        <div className="border-t border-[var(--color-border)] px-4 py-4 sm:px-6">
          <Input
            label="What should Jami correct?"
            value={correction}
            disabled={disabled}
            placeholder="For example: this is Higher tier Paper 2, not Paper 1."
            onChange={(event) => setCorrection(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled || correction.trim().length < 2}
              onClick={() => onCorrect(correction.trim())}
            >
              Correct and research again
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setCorrecting(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={disabled} onClick={onConfirm}>
              Use this format
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => setCorrecting(true)}>
              Correct it
            </Button>
            {brief.customFallbackAvailable ? (
              <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onUseCustom}>
                Use a custom full paper
              </Button>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel request
          </Button>
        </div>
      )}
    </section>
  );
}
