"use client";

import { FileField, Input } from "@/components/ui";
import PracticeStep from "@/components/practice/PracticeStep";

const PAPER_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MARK_SCHEME_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt";

export type UploadedPaperForm = {
  title: string;
  paperFile: File | null;
  markSchemeFile: File | null;
  /** Minutes as typed; empty or unreadable means no set duration. */
  duration: string;
};

/** A real paper the student already has, with its mark scheme when they have one. */
export default function PracticePaperUploadStep({
  form,
  disabled,
  onChange,
}: {
  form: UploadedPaperForm;
  disabled: boolean;
  onChange: (change: Partial<UploadedPaperForm>) => void;
}) {
  return (
    <PracticeStep
      step={2}
      title="Add the paper"
      description="Your paper stays exactly as it is underneath your ink. With no official mark scheme, Jami labels its marking as estimated."
    >
      <Input
        label="Paper title"
        value={form.title}
        disabled={disabled}
        onChange={(event) => onChange({ title: event.target.value })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FileField
          label="Paper file"
          hint="PDF, JPG, PNG or WebP"
          accept={PAPER_ACCEPT}
          file={form.paperFile}
          disabled={disabled}
          onChange={(paperFile) => onChange({ paperFile })}
        />
        <FileField
          label="Official mark scheme"
          hint="Optional — but it makes the marking far more reliable"
          accept={MARK_SCHEME_ACCEPT}
          file={form.markSchemeFile}
          disabled={disabled}
          onChange={(markSchemeFile) => onChange({ markSchemeFile })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Duration in minutes"
          type="number"
          min={0}
          max={360}
          value={form.duration}
          disabled={disabled}
          placeholder="Optional"
          onChange={(event) => onChange({ duration: event.target.value })}
        />
      </div>
    </PracticeStep>
  );
}
