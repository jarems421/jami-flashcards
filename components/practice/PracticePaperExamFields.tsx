"use client";

import { FormDisclosure, Input, OptionSwitch, Select, Textarea } from "@/components/ui";
import SettingSwitch from "@/components/ui/SettingSwitch";
import ExamCourseFields from "@/components/practice/ExamCourseFields";
import type { PracticePaperExam } from "@/hooks/usePracticePaperExam";
import { DESCRIBED_EXAM_KINDS, DESCRIBED_EXAM_LENGTHS } from "@/lib/practice/practice-paper-request";
import type { StudyFolder } from "@/lib/workspace/study-folders";

/**
 * The board, course and paper for a school folder, with a way to type a
 * course the catalogue does not list.
 */
function SchoolCourseFields({
  exam,
  folder,
  disabled,
  rememberCourse,
  onRememberCourseChange,
}: {
  exam: PracticePaperExam;
  folder: StudyFolder | null;
  disabled: boolean;
  rememberCourse: boolean;
  onRememberCourseChange: (remember: boolean) => void;
}) {
  const { course, paperChoices, chosenPaper } = exam;
  const subjectHint = `${folder?.name ?? ""} ${folder?.subject ?? ""}`;
  return (
    <div className="space-y-5">
      {folder?.examCourse ? (
        <ExamCourseFields
          value={exam.courseDraft}
          onChange={exam.setCourseDraft}
          options={exam.courseOptions}
          studyLevel={folder.studyLevel}
          subjectHint={subjectHint}
          savedCourse={folder.examCourse}
          disabled={disabled}
        />
      ) : (
        /*
         * A folder with no course yet is asked for one here, once: the choice
         * can be kept on the folder, so the next paper, and Practice
         * questions, start from it.
         */
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:p-5">
          <p className="text-sm font-semibold text-text-primary">
            {folder?.name ?? "This folder"} doesn&apos;t have a course yet
          </p>
          <p className="mt-1 text-xs leading-5 text-text-muted">Choose the board and course this paper is for.</p>
          <div className="mt-4">
            <ExamCourseFields
              value={exam.courseDraft}
              onChange={exam.setCourseDraft}
              options={exam.courseOptions}
              studyLevel={folder?.studyLevel}
              subjectHint={subjectHint}
              disabled={disabled}
            />
          </div>
          {course ? (
            <SettingSwitch
              className="mt-4 border-t border-[var(--color-border)] pt-4"
              label={`Remember this course for ${folder?.name ?? "this folder"}`}
              description="Next time it's filled in for you, here and in Practice questions."
              checked={rememberCourse}
              disabled={disabled}
              onChange={onRememberCourseChange}
            />
          ) : null}
        </div>
      )}
      {course && paperChoices.length > 0 ? (
        paperChoices.length <= 4 ? (
          <OptionSwitch
            label="Paper"
            value={chosenPaper?.code ?? ""}
            columns={paperChoices.length === 4 ? 4 : paperChoices.length === 3 ? 3 : 2}
            options={paperChoices.map((paper) => ({ value: paper.code, label: paper.title }))}
            disabled={disabled}
            onChange={exam.choosePaper}
          />
        ) : (
          <Select
            label="Paper"
            value={chosenPaper?.code ?? ""}
            disabled={disabled}
            onChange={(event) => exam.choosePaper(event.target.value)}
          >
            {paperChoices.map((paper) => (
              <option key={paper.code} value={paper.code}>
                {paper.title}
              </option>
            ))}
          </Select>
        )
      ) : null}
      {course ? null : (
        <FormDisclosure title="My course isn't listed" summary="Type it in instead">
          <div className="space-y-3">
            <Input
              label="Course and paper"
              value={exam.moduleName}
              disabled={disabled}
              placeholder="For example: OCR GCSE Computer Science, Paper 1"
              onChange={(event) => exam.setModuleName(event.target.value)}
            />
            <Textarea
              label="What it covers (optional)"
              rows={2}
              value={exam.examined}
              disabled={disabled}
              placeholder="Leave empty for the whole course"
              onChange={(event) => exam.setExamined(event.target.value)}
            />
          </div>
        </FormDisclosure>
      )}
    </div>
  );
}

/** A university module or professional exam, described in the student's own terms. */
function DescribedExamFields({
  exam,
  disabled,
  withPastPapers,
}: {
  exam: PracticePaperExam;
  disabled: boolean;
  withPastPapers: boolean;
}) {
  return (
    <div className="space-y-5">
      <Input
        label="Module"
        value={exam.moduleName}
        disabled={disabled}
        placeholder="For example: Analysis 3"
        onChange={(event) => exam.setModuleName(event.target.value)}
      />
      <OptionSwitch
        label="Kind of exam"
        value={exam.kind}
        columns={4}
        options={DESCRIBED_EXAM_KINDS.map(({ value, label }) => ({ value, label }))}
        disabled={disabled}
        onChange={exam.setKind}
      />
      <OptionSwitch
        label="How long is it?"
        value={exam.length}
        columns={5}
        options={DESCRIBED_EXAM_LENGTHS.map((option) =>
          option.value === "unsure" && withPastPapers ? { ...option, label: "Like my past papers" } : option
        )}
        disabled={disabled}
        onChange={exam.setLength}
      />
      <Textarea
        label="What's on it? (optional)"
        rows={3}
        value={exam.examined}
        disabled={disabled}
        placeholder="Topics or weeks, in your own words. For example: weeks 1–8, metric spaces, continuity and compactness."
        onChange={(event) => exam.setExamined(event.target.value)}
      />
    </div>
  );
}

/** Which exam a generated paper is for: picked for a school folder, described for anything else. */
export default function PracticePaperExamFields({
  exam,
  folder,
  disabled,
  rememberCourse,
  onRememberCourseChange,
  withPastPapers,
}: {
  exam: PracticePaperExam;
  folder: StudyFolder | null;
  disabled: boolean;
  rememberCourse: boolean;
  onRememberCourseChange: (remember: boolean) => void;
  /** The described exam's material includes past papers, so its length can follow them. */
  withPastPapers: boolean;
}) {
  return exam.schoolFolder ? (
    <SchoolCourseFields
      exam={exam}
      folder={folder}
      disabled={disabled}
      rememberCourse={rememberCourse}
      onRememberCourseChange={onRememberCourseChange}
    />
  ) : (
    <DescribedExamFields exam={exam} disabled={disabled} withPastPapers={withPastPapers} />
  );
}
