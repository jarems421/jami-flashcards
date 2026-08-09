export const STUDY_LEVEL_OPTIONS = [
  {
    value: "early-secondary",
    label: "School / early secondary",
    tutorLabel: "school or early-secondary level",
  },
  {
    value: "gcse-equivalent",
    label: "GCSE, IGCSE or equivalent",
    tutorLabel: "GCSE, IGCSE or equivalent level",
  },
  {
    value: "post-16-equivalent",
    label: "A level, IB or equivalent",
    tutorLabel: "A level, IB or equivalent level",
  },
  {
    value: "undergraduate",
    label: "University",
    tutorLabel: "undergraduate university level",
  },
  {
    value: "postgraduate",
    label: "Postgraduate",
    tutorLabel: "postgraduate level",
  },
  {
    value: "professional-other",
    label: "Professional or other",
    tutorLabel: "professional or other advanced-study level",
  },
] as const;

export type StudyLevel = (typeof STUDY_LEVEL_OPTIONS)[number]["value"];

export function isStudyLevel(value: unknown): value is StudyLevel {
  return STUDY_LEVEL_OPTIONS.some((option) => option.value === value);
}

export function normalizeStudyLevel(value: unknown): StudyLevel | undefined {
  return isStudyLevel(value) ? value : undefined;
}

export function getStudyLevelLabel(level: StudyLevel) {
  return STUDY_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

export function getStudyLevelTutorLabel(level: StudyLevel) {
  return (
    STUDY_LEVEL_OPTIONS.find((option) => option.value === level)?.tutorLabel ??
    level
  );
}
