"use client";

import { useEffect, useState } from "react";
import StudyLevelSelect from "@/components/study/StudyLevelSelect";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import { Button, Card, ConfirmDialog, Input, Select } from "@/components/ui";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import type { StudyLevel } from "@/lib/profile/study-level";
import {
  buildExamCourseSelection,
  examBoardAppliesTo,
  type ExamCourseSelection,
} from "@/lib/practice/exam-questions";
import {
  EXAM_BOARD_LABELS,
  EXAM_QUALIFICATION_LABELS,
  type ExamBoardId,
  type ExamQualification,
} from "@/lib/practice/exam-formats";
import {
  MAX_STUDY_FOLDER_SUBJECT_LENGTH,
  type StudyFolder,
} from "@/lib/workspace/study-folders";
import {
  archiveStudyFolder,
  updateStudyFolder,
} from "@/services/study/folders";
import { getExamCourseOptions } from "@/services/study/exam-practice";

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
  const [examBoard, setExamBoard] = useState<ExamBoardId | "">(folder.examCourse?.board ?? "");
  const [examQualification, setExamQualification] = useState<ExamQualification | "">(folder.examCourse?.qualification ?? "");
  const [specificationId, setSpecificationId] = useState(folder.examCourse?.specificationId ?? "");
  const [specificationTitle, setSpecificationTitle] = useState(folder.examCourse?.specificationTitle ?? "");
  const [examTier, setExamTier] = useState(folder.examCourse?.tier ?? "");
  const [courseOptions, setCourseOptions] = useState<Array<{ specificationId: string; specificationTitle: string; tiers: string[]; componentIds: string[] }>>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [color, setColor] = useState<ObjectColorId>(normalizeObjectColor(folder.color));
  const [icon, setIcon] = useState<ObjectIconId>(normalizeObjectIcon(folder.icon));
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!examBoard || !examQualification) { setCourseOptions([]); return; }
    let active = true;
    setCoursesLoading(true);
    void getExamCourseOptions({ board: examBoard, qualification: examQualification, subject }).then((items) => {
      if (!active) return;
      setCourseOptions(items);
    }).catch(() => active && setCourseOptions([])).finally(() => active && setCoursesLoading(false));
    return () => { active = false; };
  }, [examBoard, examQualification, subject]);

  const save = async () => {
    setSaving(true);
    try {
      const examCourse: ExamCourseSelection | null =
        studyLevel && examBoardAppliesTo(studyLevel) && examBoard && examQualification && specificationId.trim() && specificationTitle.trim()
          ? buildExamCourseSelection({
              board: examBoard,
              qualification: examQualification,
              specificationId,
              specificationTitle,
              tier: examTier,
              componentIds:
                courseOptions.find((course) => course.specificationId === specificationId)?.componentIds ??
                folder.examCourse?.componentIds ??
                [],
            })
          : null;
      await updateStudyFolder(userId, folder.id, {
        name,
        subject,
        studyLevel: studyLevel || null,
        color,
        icon,
        examCourse,
      });
      onSaved({
        ...folder,
        name: name.trim() || folder.name,
        subject: subject.trim() || undefined,
        studyLevel: studyLevel || undefined,
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
        <div className="text-center sm:text-left">
          <div className="text-sm font-semibold text-text-primary">Edit folder</div>
          <p className="mt-0.5 text-xs text-text-muted">
            Update how this study space looks and how Jami explains its material.
          </p>
        </div>
        <div className="mx-auto mt-4 grid max-w-[46rem] gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-start">
          <div className="grid w-full min-w-0 gap-3">
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
            {studyLevel && examBoardAppliesTo(studyLevel) ? (
              <div className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Exam course
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="Exam board" value={examBoard} onChange={(event) => setExamBoard(event.target.value as ExamBoardId | "")}>
                    <option value="">Choose board</option>
                    {Object.entries(EXAM_BOARD_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </Select>
                  <Select label="Qualification" value={examQualification} onChange={(event) => setExamQualification(event.target.value as ExamQualification | "")}>
                    <option value="">Choose qualification</option>
                    {Object.entries(EXAM_QUALIFICATION_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </Select>
                </div>
                <Select label="Current specification" value={specificationId} disabled={!examBoard || !examQualification || coursesLoading} onChange={(event) => { const selected = courseOptions.find((course) => course.specificationId === event.target.value); setSpecificationId(event.target.value); setSpecificationTitle(selected?.specificationTitle ?? ""); setExamTier(""); }}>
                  <option value="">{coursesLoading ? "Finding courses…" : "Choose course"}</option>
                  {folder.examCourse && !courseOptions.some((course) => course.specificationId === folder.examCourse?.specificationId) ? <option value={folder.examCourse.specificationId}>{folder.examCourse.specificationTitle}</option> : null}
                  {courseOptions.map((course) => <option key={course.specificationId} value={course.specificationId}>{course.specificationTitle} · {course.specificationId}</option>)}
                </Select>
                {(courseOptions.find((course) => course.specificationId === specificationId)?.tiers.length ?? 0) > 0 ? <Select label="Tier or pathway" value={examTier} onChange={(event) => setExamTier(event.target.value)}><option value="">Choose tier</option>{courseOptions.find((course) => course.specificationId === specificationId)?.tiers.map((tier) => <option key={tier} value={tier}>{tier}</option>)}</Select> : null}
              </div>
            ) : null}
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

