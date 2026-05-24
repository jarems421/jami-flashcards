import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/practice/content";

export type StudyFolder = {
  id: string;
  name: string;
  description?: string;
  subject?: string;
  color?: string;
  icon?: string;
  topicIds: string[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export const MAX_STUDY_FOLDER_NAME_LENGTH = 90;
export const MAX_STUDY_FOLDER_DESCRIPTION_LENGTH = 400;
export const MAX_STUDY_FOLDER_SUBJECT_LENGTH = 120;
export const MAX_STUDY_FOLDER_TOPIC_IDS = 30;

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

  return {
    id,
    name: name || "Untitled folder",
    description: normalizeOptionalString(data.description, MAX_STUDY_FOLDER_DESCRIPTION_LENGTH),
    subject: normalizeStudyFolderSubject(data.subject),
    color: normalizeOptionalString(data.color, 80),
    icon: normalizeOptionalString(data.icon, 40),
    topicIds: normalizeStringArray(
      data.topicIds,
      MAX_STUDY_FOLDER_TOPIC_IDS,
      120
    ),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    archived: data.archived === true,
  };
}

export function buildStudyFolderPayload(
  input: {
    name: string;
    description?: string;
    subject?: string;
    color?: string;
    icon?: string;
    topicIds?: string[];
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
    description:
      normalizeOptionalString(input.description, MAX_STUDY_FOLDER_DESCRIPTION_LENGTH) ?? null,
    subject: normalizeStudyFolderSubject(input.subject) ?? null,
    color: normalizeOptionalString(input.color, 80) ?? null,
    icon: normalizeOptionalString(input.icon, 40) ?? null,
    topicIds: normalizeStringArray(
      input.topicIds ?? [],
      MAX_STUDY_FOLDER_TOPIC_IDS,
      120
    ),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}
