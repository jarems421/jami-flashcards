"use client";

import {
  useState,
  type FormEvent,
} from "react";
import { Button, FeedbackBanner, Input } from "@/components/ui";
import { useFolderCourseForm } from "@/hooks/useFolderCourseForm";
import { getFolderNameValidationError } from "@/lib/workspace/folder-form";
import {
  MAX_STUDY_FOLDER_NAME_LENGTH,
  MAX_STUDY_FOLDER_SUBJECT_LENGTH,
  type StudyFolder,
} from "@/lib/workspace/study-folders";
import { createStudyFolder } from "@/services/study/folders";
import FolderCourseSection from "./FolderCourseSection";
import FolderLookSection from "./FolderLookSection";
import WorkspaceActionDialog from "./WorkspaceActionDialog";
import type { ObjectColorId, ObjectIconId } from "@/lib/workspace/object-card-styles";

type CreateFolderDialogProps = {
  open: boolean;
  userId: string;
  onClose: () => void;
  onCreated: (folder: StudyFolder) => void;
};

const DEFAULT_COLOR: ObjectColorId = "sky";
const DEFAULT_ICON: ObjectIconId = "none";

export default function CreateFolderDialog({
  open,
  userId,
  onClose,
  onCreated,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [color, setColor] = useState<ObjectColorId>(DEFAULT_COLOR);
  const [icon, setIcon] = useState<ObjectIconId>(DEFAULT_ICON);
  const courseForm = useFolderCourseForm({});
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = getFolderNameValidationError(name);
  const nameIsValid = nameError === null;
  const showNameError = nameTouched && Boolean(nameError);
  const needsTier = courseForm.resolvedCourse.status === "needs_tier";

  const resetForm = () => {
    setName("");
    setSubject("");
    setColor(DEFAULT_COLOR);
    setIcon(DEFAULT_ICON);
    courseForm.reset();
    setNameTouched(false);
    setError(null);
  };

  const closeDialog = () => {
    if (saving) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nameIsValid) {
      setNameTouched(true);
      return;
    }
    if (needsTier) return;

    setSaving(true);
    setError(null);
    try {
      const examCourse = courseForm.resolvedCourse.course;
      const folder = await createStudyFolder(userId, {
        name,
        subject,
        color,
        icon,
        ...(courseForm.studyLevel ? { studyLevel: courseForm.studyLevel } : {}),
        ...(examCourse ? { examCourse } : {}),
      });
      resetForm();
      onCreated(folder);
      onClose();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create folder."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceActionDialog
      open={open}
      title="Create a study space"
      description="Name the subject, say which course it is, and make it yours. Notebooks, decks and sources go inside."
      busy={saving}
      maxWidth="lg"
      onClose={closeDialog}
    >
      {error ? (
        <div className="mb-4">
          <FeedbackBanner
            type="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={saving} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Input
                data-dialog-autofocus="true"
                label="Folder name"
                value={name}
                placeholder="Biology"
                maxLength={MAX_STUDY_FOLDER_NAME_LENGTH}
                onBlur={() => setNameTouched(true)}
                onChange={(event) => {
                  setName(event.target.value);
                  if (event.target.value.trim()) setNameTouched(false);
                }}
                aria-invalid={showNameError}
                aria-describedby={
                  showNameError ? "create-folder-name-error" : undefined
                }
              />
              {showNameError ? (
                <p
                  id="create-folder-name-error"
                  className="mt-2 text-sm font-medium text-danger-text"
                >
                  {nameError}
                </p>
              ) : null}
            </div>
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
        </fieldset>

        {/*
          * Sticky, because the course fields make this a form that scrolls on
          * a phone and a tablet held sideways -- the one button that matters
          * should not be below the fold.
          */}
        <div className="sticky bottom-0 z-10 -mx-3 -mb-3 mt-5 flex flex-col gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-3 py-3 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:px-5">
          {needsTier ? (
            <p
              id="create-folder-submit-hint"
              className="text-xs leading-5 text-text-muted"
            >
              Choose your tier to finish the course.
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !nameIsValid || needsTier}
              aria-describedby={needsTier ? "create-folder-submit-hint" : undefined}
            >
              {saving ? "Creating..." : "Create folder"}
            </Button>
          </div>
        </div>
      </form>
    </WorkspaceActionDialog>
  );
}
