"use client";

import { Button, OptionSwitch, Select } from "@/components/ui";
import type { ExamCourseOptionsState } from "@/hooks/useExamCourseOptions";
import {
  arrangeExamCourseOptions,
  type ExamCourseDraft,
  type ExamCourseOption,
} from "@/lib/practice/exam-course-form";
import { examCourseLabels, examCourseName } from "@/lib/practice/exam-course-names";
import {
  EXAM_BOARDS_OFFERED,
  EXAM_BOARD_LABELS,
  isExamBoardId,
  type ExamBoardId,
} from "@/lib/practice/exam-formats";
import type { ExamCourseSelection } from "@/lib/practice/exam-questions";
import { servableExamSetTexts, type ExamSetText } from "@/lib/practice/exam-set-texts";
import type { StudyLevel } from "@/lib/profile/study-level";

type ExamCourseFieldsProps = {
  value: ExamCourseDraft;
  onChange: (draft: ExamCourseDraft) => void;
  options: ExamCourseOptionsState;
  /** Narrows the course list to the folder's level where that leaves any. */
  studyLevel?: StudyLevel | "";
  /** The folder's name and subject, used to put likely courses first. */
  subjectHint?: string;
  /** A course already saved, kept selectable if the catalogue stops listing it. */
  savedCourse?: ExamCourseSelection | null;
  disabled?: boolean;
};

function CourseOptions({
  courses,
  labels,
}: {
  courses: readonly ExamCourseOption[];
  labels: ReadonlyMap<string, string>;
}) {
  return courses.map((course) => (
    <option key={course.specificationId} value={course.specificationId}>
      {labels.get(course.specificationId) ?? examCourseName(course)}
    </option>
  ));
}

/**
 * Board, then course, then tier -- the one way Jami asks which course this is.
 *
 * A student knows they do AQA GCSE maths and that they are on Higher; they have
 * no reason to know "qualification" or "specification". So the board is asked,
 * then the course by the name they would say ("GCSE Maths", no code), then the
 * tier as a choice between the tiers that course actually has. The tier narrows
 * which papers are drawn, which is the only reason to ask it.
 */
export default function ExamCourseFields({
  value,
  onChange,
  options,
  studyLevel,
  subjectHint,
  savedCourse,
  disabled = false,
}: ExamCourseFieldsProps) {
  const { courses, loading, failed, retry } = options;
  const boards: readonly ExamBoardId[] =
    value.board && !EXAM_BOARDS_OFFERED.includes(value.board)
      ? [...EXAM_BOARDS_OFFERED, value.board]
      : EXAM_BOARDS_OFFERED;
  const { suggested, others } = arrangeExamCourseOptions(courses, {
    studyLevel,
    subjectHint,
  });
  const labels = examCourseLabels(courses);
  const selected = courses.find(
    (course) => course.specificationId === value.specificationId
  );
  const isListed = [...suggested, ...others].some(
    (course) => course.specificationId === value.specificationId
  );
  /*
   * A chosen course the list would not otherwise show -- one the level no
   * longer includes, or a saved course the catalogue has dropped -- stays in
   * the dropdown, so the field never shows a placeholder over a real choice.
   */
  const unlistedLabel =
    !value.specificationId || isListed
      ? null
      : selected
        ? labels.get(selected.specificationId) ?? examCourseName(selected)
        : savedCourse &&
            savedCourse.board === value.board &&
            savedCourse.specificationId === value.specificationId
          ? examCourseName(savedCourse)
          : null;
  const hasChoices = suggested.length + others.length > 0 || Boolean(unlistedLabel);
  const tiers = selected?.tiers ?? [];
  /*
   * Only where the specification sets texts and a person has checked the list.
   * Most courses set none, and an unchecked list would name texts the board
   * does not set -- so the question is not asked at all rather than asked
   * wrongly.
   */
  const setTexts = servableExamSetTexts(value.specificationId);
  const chosenSetTexts = value.setTextIds ?? [];
  const setTextChoices = setTexts.reduce<Array<[string, ExamSetText[]]>>((choices, text) => {
    const existing = choices.find(([choice]) => choice === text.choice);
    if (existing) existing[1].push(text);
    else choices.push([text.choice, [text]]);
    return choices;
  }, []);
  const toggleSetText = (id: string) =>
    onChange({
      ...value,
      setTextIds: chosenSetTexts.includes(id)
        ? chosenSetTexts.filter((chosen) => chosen !== id)
        : [...chosenSetTexts, id],
    });

  const placeholder = !value.board
    ? "Choose a board first"
    : loading
      ? "Finding courses…"
      : failed
        ? "Courses could not load"
        : hasChoices
          ? "Choose your course"
          : "No courses listed for this board yet";

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Exam board"
          value={value.board}
          disabled={disabled}
          onChange={(event) => {
            const board = event.target.value;
            onChange({
              board: isExamBoardId(board) ? board : "",
              specificationId: "",
              tier: "",
            });
          }}
        >
          <option value="">Choose board</option>
          {boards.map((id) => (
            <option key={id} value={id}>
              {EXAM_BOARD_LABELS[id]}
            </option>
          ))}
        </Select>

        <Select
          label="Course"
          value={value.specificationId}
          disabled={disabled || !value.board || loading || !hasChoices}
          onChange={(event) => {
            const course = courses.find(
              (item) => item.specificationId === event.target.value
            );
            onChange({
              ...value,
              specificationId: event.target.value,
              // One tier is not a question.
              tier:
                course?.tiers.length === 1 ? course.tiers.at(0)?.name ?? "" : "",
            });
          }}
        >
          <option value="">{placeholder}</option>
          {unlistedLabel ? (
            <option value={value.specificationId}>{unlistedLabel}</option>
          ) : null}
          {suggested.length > 0 ? (
            <>
              <optgroup label="Suggested">
                <CourseOptions courses={suggested} labels={labels} />
              </optgroup>
              {others.length > 0 ? (
                <optgroup label="Other courses">
                  <CourseOptions courses={others} labels={labels} />
                </optgroup>
              ) : null}
            </>
          ) : (
            <CourseOptions courses={others} labels={labels} />
          )}
        </Select>
      </div>

      {failed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2">
          <p className="text-xs leading-5 text-text-muted">
            Courses for this board could not load.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {setTexts.length > 0 ? (
        <div>
          <p className="text-sm font-medium text-text">Your set texts</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            The paper prints a question on every text it sets, and you answer the one on yours.
            Telling Jami which you studied keeps the rest out of your practice.
          </p>
          {setTextChoices.map(([choice, choiceTexts]) => (
            <fieldset key={choice} className="mt-3 border-0 p-0">
              <legend className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {choice}
              </legend>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {choiceTexts.map((text) => (
                  <label key={text.id} className="flex items-start gap-2 text-sm leading-5 text-text">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={chosenSetTexts.includes(text.id)}
                      disabled={disabled}
                      onChange={() => toggleSetText(text.id)}
                    />
                    <span>
                      {text.label}
                      {text.author ? <span className="text-text-muted"> · {text.author}</span> : null}
                      {text.note ? <span className="text-text-muted"> · {text.note}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      {tiers.length > 0 ? (
        <div>
          <OptionSwitch
            label="Tier"
            value={value.tier}
            options={tiers.map((tier) => ({ value: tier.name, label: tier.name }))}
            columns={tiers.length >= 3 ? 3 : 2}
            disabled={disabled}
            onChange={(tier) => onChange({ ...value, tier })}
          />
          <p className="mt-2 text-xs leading-5 text-text-muted">
            It is on your exam entry or timetable. Ask your teacher if you are not sure.
          </p>
        </div>
      ) : null}
    </div>
  );
}
