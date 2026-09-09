"use client";

import { useEffect, useState } from "react";
import { Button, Card, FeedbackBanner, Select } from "@/components/ui";
import {
  EXAM_BOARD_LABELS,
  EXAM_QUALIFICATION_LABELS,
  type ExamBoardId,
  type ExamQualification,
} from "@/lib/practice/exam-formats";
import type { ExamCourseSelection } from "@/lib/practice/exam-questions";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getExamCourseOptions } from "@/services/study/exam-practice";
import { updateStudyFolder } from "@/services/study/folders";

type CourseOption = {
  specificationId: string;
  specificationTitle: string;
  tiers: string[];
  componentIds: string[];
};

/**
 * The one thing a folder needs before it can practise: which course this is.
 *
 * Asked once, here, rather than at the start of every session — a real question
 * only means anything against a specification, and getting the wrong one is
 * worse than getting none.
 */
export default function ExamCourseSetup({
  userId,
  folder,
  onSaved,
}: {
  userId: string;
  folder: StudyFolder;
  onSaved(folder: StudyFolder): void;
}) {
  const [board, setBoard] = useState<ExamBoardId | "">("");
  const [qualification, setQualification] = useState<ExamQualification | "">("");
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [specificationId, setSpecificationId] = useState("");
  const [tier, setTier] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!board || !qualification) {
      setCourses([]);
      return;
    }
    let active = true;
    setLoading(true);
    setSpecificationId("");
    setTier("");
    void getExamCourseOptions({ board, qualification, subject: folder.subject })
      .then((items) => active && setCourses(items))
      .catch(() => active && setCourses([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [board, folder.subject, qualification]);

  const selected = courses.find((course) => course.specificationId === specificationId);

  const save = async () => {
    if (!board || !qualification || !selected) return;
    setSaving(true);
    setError("");
    try {
      const examCourse: ExamCourseSelection = {
        board,
        qualification,
        specificationId: selected.specificationId,
        specificationTitle: selected.specificationTitle,
        tier: tier || undefined,
        componentIds: selected.componentIds,
      };
      await updateStudyFolder(userId, folder.id, { examCourse });
      onSaved({ ...folder, examCourse, updatedAt: Date.now() });
    } catch {
      setError("Your course could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card tone="warm" padding="md">
      {error ? (
        <div className="mb-4">
          <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} />
        </div>
      ) : null}
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
        One-time course setup
      </p>
      <h3 className="mt-2 text-lg font-semibold text-text-primary">
        Which course is {folder.name} for?
      </h3>
      <p className="mt-1 max-w-lg text-sm leading-5 text-text-muted">
        Questions are matched to your exact specification, so this is asked once and then remembered.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Select
          label="Exam board"
          value={board}
          onChange={(event) => setBoard(event.target.value as ExamBoardId | "")}
        >
          <option value="">Choose board</option>
          {Object.entries(EXAM_BOARD_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          label="Qualification"
          value={qualification}
          onChange={(event) => setQualification(event.target.value as ExamQualification | "")}
        >
          <option value="">Choose qualification</option>
          {Object.entries(EXAM_QUALIFICATION_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <Select
        label="Current specification"
        value={specificationId}
        disabled={!board || !qualification || loading}
        containerClassName="mt-3"
        onChange={(event) => {
          setSpecificationId(event.target.value);
          setTier("");
        }}
      >
        <option value="">
          {loading ? "Finding courses…" : courses.length ? "Choose course" : "No current courses found"}
        </option>
        {courses.map((course) => (
          <option key={course.specificationId} value={course.specificationId}>
            {course.specificationTitle} · {course.specificationId}
          </option>
        ))}
      </Select>

      {selected?.tiers.length ? (
        <Select
          label="Tier or pathway"
          value={tier}
          containerClassName="mt-3"
          onChange={(event) => setTier(event.target.value)}
        >
          <option value="">Choose tier</option>
          {selected.tiers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      ) : null}

      <div className="mt-5 flex justify-end">
        <Button disabled={!selected || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save course"}
        </Button>
      </div>
    </Card>
  );
}
