"use client";

import { Input } from "@/components/ui";
import type { ObjectColorId, ObjectIconId } from "@/lib/workspace/object-card-styles";
import {
  MAX_STUDY_FOLDER_NAME_LENGTH,
  MAX_STUDY_FOLDER_SUBJECT_LENGTH,
} from "@/lib/workspace/study-folders";
import FolderObjectCard from "./FolderObjectCard";

type FolderDetailsFieldsProps = {
  name: string;
  subject: string;
  color: ObjectColorId;
  icon: ObjectIconId;
  onNameChange: (name: string) => void;
  onSubjectChange: (subject: string) => void;
  onNameBlur?: () => void;
  /** Shown under the name once there is something to say. */
  nameError?: string | null;
  nameErrorId?: string;
};

/**
 * The folder, as it will look, beside the two things that name it.
 *
 * The preview leads because it is what is being made: the colour and icon
 * chosen below change it in place, so the form reads as making a folder rather
 * than filling in one.
 */
export default function FolderDetailsFields({
  name,
  subject,
  color,
  icon,
  onNameChange,
  onSubjectChange,
  onNameBlur,
  nameError = null,
  nameErrorId,
}: FolderDetailsFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-[6.75rem_minmax(0,1fr)] sm:items-center sm:gap-5">
      <div aria-hidden="true" className="mx-auto w-[6.75rem] sm:mx-0">
        <FolderObjectCard compact title={name.trim() || "New folder"} color={color} icon={icon} />
      </div>
      <div className="grid gap-3">
        <div>
          <Input
            data-dialog-autofocus="true"
            label="Folder name"
            value={name}
            placeholder="Biology"
            maxLength={MAX_STUDY_FOLDER_NAME_LENGTH}
            onBlur={onNameBlur}
            onChange={(event) => onNameChange(event.target.value)}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? nameErrorId : undefined}
          />
          {nameError ? (
            <p id={nameErrorId} className="mt-2 text-sm font-medium text-danger-text">
              {nameError}
            </p>
          ) : null}
        </div>
        <Input
          label="Subject detail"
          value={subject}
          placeholder="Optional"
          maxLength={MAX_STUDY_FOLDER_SUBJECT_LENGTH}
          onChange={(event) => onSubjectChange(event.target.value)}
        />
      </div>
    </div>
  );
}
