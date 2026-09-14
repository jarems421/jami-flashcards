"use client";

import { useState } from "react";
import FolderCourseSection from "@/components/workspace/FolderCourseSection";
import FolderDetailsFields from "@/components/workspace/FolderDetailsFields";
import FolderLookSection from "@/components/workspace/FolderLookSection";
import { Button, Card, ConfirmDialog } from "@/components/ui";
import { useFolderCourseForm } from "@/hooks/useFolderCourseForm";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  archiveStudyFolder,
  updateStudyFolder,
} from "@/services/study/folders";

type FolderEditorProps = {
  userId: string;
  folder: StudyFolder;
  onSaved: (folder: StudyFolder) => void;
  onArchived: () => void;
  onCancel: () => void;
  onError: (error: unknown, fallback: string) => void;
};

/**
 * A folder's settings, opened in place above its contents.
 *
 * Laid out as the folder creation dialog is -- the folder beside its name, then
 * its look, then the course folded away -- so making a folder and changing one
 * are the same form, and archiving sits apart from saving rather than beside it.
 */
export default function FolderEditor({
  userId,
  folder,
  onSaved,
  onArchived,
  onCancel,
  onError,
}: FolderEditorProps) {
  const [name, setName] = useState(folder.name);
  const [subject, setSubject] = useState(folder.subject ?? "");
  const courseForm = useFolderCourseForm({
    studyLevel: folder.studyLevel,
    examCourse: folder.examCourse,
  });
  const [color, setColor] = useState<ObjectColorId>(normalizeObjectColor(folder.color));
  const [icon, setIcon] = useState<ObjectIconId>(normalizeObjectIcon(folder.icon));
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const needsTier = courseForm.resolvedCourse.status === "needs_tier";

  const save = async () => {
    if (needsTier) return;
    setSaving(true);
    try {
      const studyLevel = courseForm.studyLevel || null;
      /*
       * With Past Paper Practice switched off the course can be neither seen
       * nor changed here, so it is left exactly as it was rather than cleared.
       */
      const courseEditable = featureFlags.enablePastPaperPractice;
      const examCourse = courseEditable
        ? courseForm.resolvedCourse.course
        : courseForm.levelTakesCourse
          ? folder.examCourse ?? null
          : null;
      await updateStudyFolder(userId, folder.id, {
        name,
        subject,
        studyLevel,
        color,
        icon,
        ...(courseEditable ? { examCourse } : {}),
      });
      onSaved({
        ...folder,
        name: name.trim() || folder.name,
        subject: subject.trim() || undefined,
        studyLevel: studyLevel ?? undefined,
        color,
        icon,
        examCourse: examCourse ?? undefined,
        updatedAt: Date.now(),
      });
    } catch (error) {
      onError(error, "Could not update folder.");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    try {
      await archiveStudyFolder(userId, folder.id);
      setConfirmArchive(false);
      onArchived();
    } catch (error) {
      setConfirmArchive(false);
      onError(error, "Could not archive folder.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card padding="none" className="mx-auto w-full max-w-3xl">
        <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-text-primary">Folder settings</h2>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              Its name, how it looks, and the course it belongs to.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close folder settings"
            disabled={saving}
            onClick={onCancel}
            className="-mr-2 -mt-1 shrink-0"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </Button>
        </div>

        <div className="grid gap-6 border-t border-[var(--color-border)] px-4 py-5 sm:px-6">
          <FolderDetailsFields
            name={name}
            subject={subject}
            color={color}
            icon={icon}
            onNameChange={setName}
            onSubjectChange={setSubject}
          />

          <FolderLookSection
            color={color}
            icon={icon}
            onColorChange={setColor}
            onIconChange={setIcon}
          />

          <FolderCourseSection
            form={courseForm}
            subjectHint={`${name} ${subject}`}
            disabled={saving}
          />
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setConfirmArchive(true)}
            className="self-start text-danger-text"
          >
            Archive folder
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {needsTier ? (
              <p className="mr-1 text-xs text-text-muted">Choose your tier to finish the course.</p>
            ) : null}
            <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !name.trim() || needsTier}
              onClick={() => void save()}
            >
              {saving ? "Saving..." : "Save folder"}
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive folder?"
        description="This removes the folder view, but does not delete the decks or sources inside it."
        confirmLabel="Archive folder"
        busy={saving}
        onConfirm={() => void archive()}
        onClose={() => setConfirmArchive(false)}
      />
    </>
  );
}
