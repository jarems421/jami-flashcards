import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/material/content";
import {
  normalizeStudyLevel,
  type StudyLevel,
} from "@/lib/profile/study-level";
import { normalizeFolderTutorInstructions } from "@/lib/ai/tutor-personalisation";
import {
  examBoardAppliesTo,
  type ExamCourseSelection,
} from "@/lib/practice/exam-questions";

export type StudyFolder = {
  id: string;
  name: string;
  subject?: string;
  studyLevel?: StudyLevel;
  examCourse?: ExamCourseSelection;
  color?: string;
  icon?: string;
  topicIds: string[];
  /**
   * What the student has told Jami about teaching this subject.
   *
   * Empty for every folder that has never been given any, which is the same
   * thing a folder written before this field existed reads as -- so there is
   * nothing to migrate. Edited in Tutor settings rather than in the folder
   * itself, because all the durable Tutor controls live in one place.
   */
  tutorInstructions: string;
  tutorInstructionsUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export const MAX_STUDY_FOLDER_NAME_LENGTH = 90;
export const MAX_STUDY_FOLDER_SUBJECT_LENGTH = 120;
export const MAX_STUDY_FOLDER_TOPIC_IDS = 30;

function normalizeExamCourse(value: unknown): ExamCourseSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const board = typeof input.board === "string" ? input.board.trim() : "";
  const qualification = typeof input.qualification === "string" ? input.qualification.trim() : "";
  const specificationId = typeof input.specificationId === "string" ? input.specificationId.trim().slice(0, 160) : "";
  const specificationTitle = typeof input.specificationTitle === "string" ? input.specificationTitle.trim().slice(0, 240) : "";
  if (!board || !qualification || !specificationId || !specificationTitle) return undefined;
  return {
    board: board as ExamCourseSelection["board"],
    qualification: qualification as ExamCourseSelection["qualification"],
    specificationId,
    specificationTitle,
    tier: normalizeOptionalString(input.tier, 120),
    componentIds: normalizeStringArray(input.componentIds, 20, 160),
  };
}

export function normalizeStudyFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_STUDY_FOLDER_NAME_LENGTH);
}

export function normalizeStudyFolderSubject(value: unknown) {
  return normalizeOptionalString(value, MAX_STUDY_FOLDER_SUBJECT_LENGTH);
}

export function mapStudyFolderData(
  id: string,
  data: Record<string, unknown>
): StudyFolder {
  const name = normalizeStudyFolderName(typeof data.name === "string" ? data.name : "");

  const studyLevel = normalizeStudyLevel(data.studyLevel);
  return {
    id,
    name: name || "Untitled folder",
    subject: normalizeStudyFolderSubject(data.subject),
    studyLevel,
    examCourse: examBoardAppliesTo(studyLevel) ? normalizeExamCourse(data.examCourse) : undefined,
    color: normalizeOptionalString(data.color, 80),
    icon: normalizeOptionalString(data.icon, 40),
    topicIds: normalizeStringArray(
      data.topicIds,
      MAX_STUDY_FOLDER_TOPIC_IDS,
      120
    ),
    tutorInstructions: normalizeFolderTutorInstructions(data.tutorInstructions),
    tutorInstructionsUpdatedAt:
      typeof data.tutorInstructionsUpdatedAt === "number"
        ? data.tutorInstructionsUpdatedAt
        : 0,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    archived: data.archived === true,
  };
}

export function buildStudyFolderPayload(
  input: {
    name: string;
    subject?: string;
    color?: string;
    icon?: string;
    topicIds?: string[];
    examCourse?: ExamCourseSelection;
    now?: number;
  }
) {
  const name = normalizeStudyFolderName(input.name);
  if (!name) {
    throw new Error("Folder name is required.");
  }

  const now = input.now ?? Date.now();

  return {
    name,
    subject: normalizeStudyFolderSubject(input.subject) ?? null,
    color: normalizeOptionalString(input.color, 80) ?? null,
    icon: normalizeOptionalString(input.icon, 40) ?? null,
    topicIds: normalizeStringArray(
      input.topicIds ?? [],
      MAX_STUDY_FOLDER_TOPIC_IDS,
      120
    ),
    examCourse: input.examCourse ?? null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}
