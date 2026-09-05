export const STUDY_LEVEL_OPTIONS = [
  {
    value: "early-secondary",
    label: "School / early secondary",
    shortLabel: "School",
    tutorLabel: "school or early-secondary level",
    /**
     * Whether naming the actual courses is what makes the level useful.
     *
     * Below sixth form a level is a good enough description on its own: "GCSE"
     * narrows the vocabulary and the assumed knowledge about as far as they go.
     * From A level upwards it stops being one -- two people who both said
     * "University" might be reading Law and Astrophysics -- so those levels ask
     * for the subjects and the tutor gets to know which one it is talking to.
     */
    needsSubjects: false,
  },
  {
    value: "gcse-equivalent",
    label: "GCSE, IGCSE or equivalent",
    shortLabel: "GCSE",
    tutorLabel: "GCSE, IGCSE or equivalent level",
    needsSubjects: false,
  },
  {
    value: "post-16-equivalent",
    label: "A level, IB or equivalent",
    shortLabel: "A level",
    tutorLabel: "A level, IB or equivalent level",
    needsSubjects: true,
  },
  {
    value: "undergraduate",
    label: "University",
    shortLabel: "University",
    tutorLabel: "undergraduate university level",
    needsSubjects: true,
  },
  {
    value: "postgraduate",
    label: "Postgraduate",
    shortLabel: "Postgrad",
    tutorLabel: "postgraduate level",
    needsSubjects: true,
  },
  {
    value: "professional-other",
    label: "Professional or other",
    shortLabel: "Professional",
    tutorLabel: "professional or other advanced-study level",
    needsSubjects: true,
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

/** The label for a chip or an inline sentence, where the full one is a mouthful. */
export function getStudyLevelShortLabel(level: StudyLevel) {
  return (
    STUDY_LEVEL_OPTIONS.find((option) => option.value === level)?.shortLabel ??
    level
  );
}

export function getStudyLevelTutorLabel(level: StudyLevel) {
  return (
    STUDY_LEVEL_OPTIONS.find((option) => option.value === level)?.tutorLabel ??
    level
  );
}

/** Whether this level is too broad to teach from without knowing the subjects. */
export function studyLevelNeedsSubjects(level: StudyLevel | null | undefined) {
  if (!level) return false;
  return (
    STUDY_LEVEL_OPTIONS.find((option) => option.value === level)
      ?.needsSubjects === true
  );
}
