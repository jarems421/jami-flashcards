"use client";

import { useState } from "react";
import FolderCourseSection from "@/components/workspace/FolderCourseSection";
import FolderLookSection from "@/components/workspace/FolderLookSection";
import { Button, Card, ConfirmDialog, Input } from "@/components/ui";
import { useFolderCourseForm } from "@/hooks/useFolderCourseForm";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import {
  MAX_STUDY_FOLDER_NAME_LENGTH,
  MAX_STUDY_FOLDER_SUBJECT_LENGTH,
  type StudyFolder,
} from "@/lib/workspace/study-folders";
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
      <Card padding="sm" className="mx-auto max-w-[52rem]">
        <div className="px-1 text-center sm:px-2 sm:text-left">
          <div className="text-sm font-semibold text-text-primary">Edit folder</div>
          <p className="mt-0.5 text-xs text-text-muted">
            Update how this study space looks, which course it is, and how Jami explains its material.
          </p>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              data-dialog-autofocus="true"
              label="Folder name"
              value={name}
              maxLength={MAX_STUDY_FOLDER_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              label="Subject detail"
              value={subject}
              placeholder="Optional"
              maxLength={MAX_STUDY_FOLDER_SUBJECT_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <FolderCourseSection
            form={courseForm}
            subjectHint={`${name} ${subject}`}
            disabled={saving}
          />

          <FolderLookSection
            name={name}
            color={color}
            icon={icon}
            onColorChange={setColor}
            onIconChange={setIcon}
          />
        </div>

        <div className="mt-4 flex min-h-[3.25rem] flex-wrap items-center justify-center gap-3 border-t border-[var(--color-border)] px-1 pt-3 sm:justify-between sm:px-2">
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={saving}
            onClick={() => setConfirmArchive(true)}
          >
            Archive folder
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {needsTier ? (
              <p className="text-xs text-text-muted">Choose your tier to finish the course.</p>
            ) : null}
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
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
