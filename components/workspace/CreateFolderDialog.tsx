"use client";

import {
  useState,
  type FormEvent,
} from "react";
import { Button, FeedbackBanner, Input } from "@/components/ui";
import { getFolderNameValidationError } from "@/lib/workspace/folder-form";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { createStudyFolder } from "@/services/study/folders";
import { ObjectStylePicker } from "./ObjectStylePicker";
import WorkspaceActionDialog from "./WorkspaceActionDialog";
import type { ObjectColorId, ObjectIconId } from "./object-card-styles";

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
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = getFolderNameValidationError(name);
  const nameIsValid = nameError === null;
  const showNameError = nameTouched && Boolean(nameError);

  const resetForm = () => {
    setName("");
    setSubject("");
    setColor(DEFAULT_COLOR);
    setIcon(DEFAULT_ICON);
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

    setSaving(true);
    setError(null);
    try {
      const folder = await createStudyFolder(userId, {
        name,
        subject,
        color,
        icon,
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
      description="Start with a broad subject. You can add notebooks, decks, and sources inside it."
      busy={saving}
      maxWidth="lg"
      onClose={closeDialog}
    >
      {error ? (
        <div className="mb-5">
          <FeedbackBanner
            type="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <fieldset disabled={saving} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Input
                data-dialog-autofocus="true"
                label="Folder name"
                value={name}
                placeholder="Biology"
                maxLength={90}
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
              maxLength={120}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="app-subtle-panel rounded-[1.3rem] p-4 sm:p-5">
            <ObjectStylePicker
              color={color}
              icon={icon}
              onColorChange={setColor}
              onIconChange={setIcon}
              colorLabel="Folder colour"
              iconLabel="Folder icon"
            />
          </div>
        </fieldset>

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={closeDialog}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !nameIsValid}>
            {saving ? "Creating..." : "Create folder"}
          </Button>
        </div>
      </form>
    </WorkspaceActionDialog>
  );
}
