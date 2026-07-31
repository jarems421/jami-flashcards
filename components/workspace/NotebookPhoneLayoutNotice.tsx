"use client";

import Link from "next/link";
import { Button, Card } from "@/components/ui";

type NotebookPhoneLayoutNoticeProps = {
  open: boolean;
  /** True once the student has opted into the full pen toolbar on a phone. */
  fullEditing: boolean;
  onToggleFullEditing: () => void;
};

/**
 * Phones get viewing and typed notes; pen and page editing want an iPad or a
 * desktop. The notice says so without locking the student out.
 */
export default function NotebookPhoneLayoutNotice({
  open,
  fullEditing,
  onToggleFullEditing,
}: NotebookPhoneLayoutNoticeProps) {
  if (!open) return null;

  return (
    <div className="absolute left-3 right-3 top-3 z-30 mx-auto max-w-2xl">
      <Card tone="warm" padding="sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              Notebook editing works best on iPad or desktop.
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              View pages and edit text here, or continue anyway for full
              controls.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={fullEditing ? "secondary" : "primary"}
              onClick={onToggleFullEditing}
            >
              {fullEditing ? "Use light mode" : "Continue anyway"}
            </Button>
            <Link
              href="/dashboard/study"
              className="app-button-secondary inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium transition duration-fast"
            >
              Go to flashcards
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
