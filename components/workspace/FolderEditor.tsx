"use client";

import { useState } from "react";
import StudyLevelSelect from "@/components/study/StudyLevelSelect";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import { Button, Card, ConfirmDialog, Input } from "@/components/ui";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import type { StudyLevel } from "@/lib/profile/study-level";
import {
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
  const [studyLevel, setStudyLevel] = useState<StudyLevel | "">(
    folder.studyLevel ?? ""
  );
  const [color, setColor] = useState<ObjectColorId>(normalizeObjectColor(folder.color));
  const [icon, setIcon] = useState<ObjectIconId>(normalizeObjectIcon(folder.icon));
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateStudyFolder(userId, folder.id, {
        name,
        subject,
        studyLevel: studyLevel || null,
        color,
        icon,
      });
      onSaved({
        ...folder,
        name: name.trim() || folder.name,
        subject: subject.trim() || undefined,
        studyLevel: studyLevel || undefined,
        color,
        icon,
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
      <Card padding="sm" className="mx-auto max-w-[44rem]">
        <div className="text-center sm:text-left">
          <div className="text-sm font-semibold text-text-primary">Edit folder</div>
          <p className="mt-0.5 text-xs text-text-muted">
            Update how this study space looks and how Jami explains its material.
          </p>
        </div>
        <div className="mx-auto mt-4 grid max-w-[28rem] gap-3 sm:grid-cols-[minmax(0,18rem)_8.5rem] sm:items-start">
          <div className="grid w-full max-w-[18rem] gap-3">
            <Input
              data-dialog-autofocus="true"
              label="Folder name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              label="Subject detail"
              value={subject}
              placeholder="Optional"
              maxLength={MAX_STUDY_FOLDER_SUBJECT_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
            />
            <StudyLevelSelect
              value={studyLevel}
              emptyLabel="Use account default"
              description="Overrides your account preference only inside this folder."
              onChange={setStudyLevel}
            />
          </div>
          <div className="app-subtle-panel rounded-md p-2">
            <FolderObjectCard
              title={name.trim() || "Folder preview"}
              color={color}
              icon={icon}
            />
          </div>
          <div className="sm:col-span-2">
            <ObjectStylePicker
              color={color}
              icon={icon}
              onColorChange={setColor}
              onIconChange={setIcon}
              colorLabel="Folder colour"
              iconLabel="Folder icon"
              compact
              centered
            />
          </div>
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
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || !name.trim()}
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

