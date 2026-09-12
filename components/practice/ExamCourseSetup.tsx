"use client";

import { useEffect, useState } from "react";
import { Button, Card, FeedbackBanner, Select } from "@/components/ui";
import { EXAM_BOARD_LABELS, isExamQualification, type ExamBoardId } from "@/lib/practice/exam-formats";
import { buildExamCourseSelection } from "@/lib/practice/exam-questions";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getExamCourseOptions } from "@/services/study/exam-practice";
import { updateStudyFolder } from "@/services/study/folders";

type CourseOption = {
  specificationId: string;
  specificationTitle: string;
  qualification: string;
  qualificationLabel: string;
  componentIds: string[];
  tiers: Array<{ name: string; componentIds: string[] }>;
};

/**
 * The one thing a folder needs before it can practise: which course this is.
 *
 * Asked once, here, rather than at the start of every session -- a real
 * question only means anything against a specification, and getting the wrong
 * one is worse than getting none.
 *
 * It used to ask four questions, three of them in words a student has no
 * reason to know. "Qualification" and "Current specification" are how an exam
 * board files a course; a sixteen-year-old knows they do AQA GCSE maths and
 * that they are on Higher. So the board is asked, then the course by its name
 * with the code kept small beside it, then the tier as two buttons -- and the
 * tier now actually narrows which papers are drawn, which is the only reason
 * to ask.
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
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [specificationId, setSpecificationId] = useState("");
  const [tier, setTier] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!board) {
      setCourses([]);
      return;
    }
    let active = true;
    setLoading(true);
    setSpecificationId("");
    setTier("");
    void getExamCourseOptions({ board, subject: folder.subject })
      .then((items) => active && setCourses(items))
      .catch(() => active && setCourses([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [board, folder.subject]);

  const selected = courses.find((course) => course.specificationId === specificationId);
  const tiers = selected?.tiers ?? [];
  const chosenTier = tiers.find((item) => item.name === tier);
  const ready = Boolean(selected && (tiers.length === 0 || chosenTier));

  const save = async () => {
    if (!board || !selected || !ready) return;
    if (!isExamQualification(selected.qualification)) {
      setError("That course could not be read. Please pick another.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const examCourse = buildExamCourseSelection({
        board,
        qualification: selected.qualification,
        specificationId: selected.specificationId,
        specificationTitle: selected.specificationTitle,
        tier: chosenTier?.name ?? "",
        /*
         * The tier's own papers, where it has them. A Foundation paper cannot
         * ask a Higher student what they are examined on, so a tier that
         * narrows nothing is a question that was not worth asking.
         */
        componentIds: chosenTier?.componentIds.length
          ? chosenTier.componentIds
          : selected.componentIds,
      });
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
        Set up once
      </p>
      <h3 className="mt-2 text-lg font-semibold text-text-primary">
        What are you studying in {folder.name}?
      </h3>
      <p className="mt-1 max-w-lg text-sm leading-5 text-text-muted">
        We only show questions from your own course, so we ask once and remember it.
      </p>

      <Select
        label="Your exam board"
        value={board}
        containerClassName="mt-5 max-w-md"
        onChange={(event) => setBoard(event.target.value as ExamBoardId | "")}
      >
        <option value="">Choose your board</option>
        {Object.entries(EXAM_BOARD_LABELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>

      {board ? (
        <Select
          label="Your course"
          value={specificationId}
          disabled={loading || courses.length === 0}
          containerClassName="mt-3 max-w-md"
          onChange={(event) => {
            setSpecificationId(event.target.value);
            setTier("");
          }}
        >
          <option value="">
            {loading
              ? "Looking for your courses…"
              : courses.length
                ? "Choose your course"
                : "No courses found for this board"}
          </option>
          {courses.map((course) => (
            <option key={course.specificationId} value={course.specificationId}>
              {course.qualificationLabel} {course.specificationTitle} ({course.specificationId})
            </option>
          ))}
        </Select>
      ) : null}

      {tiers.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-text-primary">Which tier are you taking?</p>
          <p className="mt-0.5 text-sm text-text-muted">
            It is on your timetable or your exam entry. Ask your teacher if you are not sure.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tiers.map((item) => (
              <Button
                key={item.name}
                type="button"
                variant={tier === item.name ? "primary" : "secondary"}
                aria-pressed={tier === item.name}
                onClick={() => setTier(item.name)}
              >
                {item.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex justify-end">
        <Button disabled={!ready || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save and start practising"}
        </Button>
      </div>
    </Card>
  );
}
