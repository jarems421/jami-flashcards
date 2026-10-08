import { isStudyMode, STUDY_MODES, type CardStudySettings, type StudyMode } from "@/lib/study/study-modes";

/**
 * A card's own study settings: what its author says counts as right, the wrong
 * answers they wrote for multiple choice, the words they want blanked, and the
 * ways they do not want it asked.
 *
 * Learn, the answer check and preparation have honoured these for a long time;
 * nothing wrote them. They are fingerprinted with the card -- a saved exercise
 * or a prepared bundle is only reused while they are unchanged -- and the
 * server and the browser each compute that fingerprint, so both read them
 * through `normalizeCardStudySettings`: the same validation and one fixed key
 * order, or a card would look changed to one of them forever.
 */

/** As many as the server's answer check reads. */
export const MAX_OWN_ACCEPTED_ANSWERS = 6;
/** Learn shows three; more lets it pick the three that match the answer's shape. */
export const MAX_OWN_WRONG_ANSWERS = 6;
/** Gap Fill hides at most three. */
export const MAX_OWN_PINNED_GAPS = 3;
/** Longer than a multiple-choice option may be, and longer than anything typed in a box. */
export const MAX_OWN_ANSWER_LENGTH = 160;
const MAX_REQUIRED_CONCEPTS = 5;
const MAX_EXPLANATIONS = 12;
const MAX_EXPLANATION_LENGTH = 300;

/** The ways a student can turn off for one card. Turning it over is always there. */
export const OWN_TOGGLEABLE_MODES: readonly StudyMode[] = ["type-answer", "gap-fill", "multiple-choice"];

/**
 * A list as kept: trimmed, without empties or repeats, no longer than its cap.
 * Repeats are compared without case, except for words to blank, which must
 * match the answer exactly.
 */
function readList(value: unknown, max: number, options: { exactCase?: boolean } = {}): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.trim().slice(0, MAX_OWN_ANSWER_LENGTH);
    const key = options.exactCase ? text : text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    list.push(text);
    if (list.length === max) break;
  }
  return list;
}

function readModes(value: unknown): StudyMode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modes = new Set(value.filter(isStudyMode));
  return STUDY_MODES.filter((mode) => modes.has(mode));
}

function readExplanations(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .flatMap(([option, reason]): [string, string][] =>
      typeof reason === "string" && option.trim() && reason.trim()
        ? [[option.trim().slice(0, MAX_OWN_ANSWER_LENGTH), reason.trim().slice(0, MAX_EXPLANATION_LENGTH)]]
        : []
    )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_EXPLANATIONS);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * A card's own settings as stored, or undefined when it has none.
 *
 * Only what an author sets is kept: generated material lives beside the card,
 * never on it, and is dropped here if it ever arrives. An empty list is kept
 * as it was, because it means something -- no wrong answers of the author's
 * means no multiple choice -- and only the editor decides to leave one off.
 */
export function normalizeCardStudySettings(value: unknown): CardStudySettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const settings: CardStudySettings = {};
  const acceptedAnswers = readList(raw.acceptedAnswers, MAX_OWN_ACCEPTED_ANSWERS);
  if (acceptedAnswers) settings.acceptedAnswers = acceptedAnswers;
  const requiredConcepts = readList(raw.requiredConcepts, MAX_REQUIRED_CONCEPTS);
  if (requiredConcepts) settings.requiredConcepts = requiredConcepts;
  if (typeof raw.numericTolerance === "number" && Number.isFinite(raw.numericTolerance) && raw.numericTolerance >= 0) {
    settings.numericTolerance = raw.numericTolerance;
  }
  if (typeof raw.requireUnits === "boolean") settings.requireUnits = raw.requireUnits;
  if (typeof raw.caseSensitive === "boolean") settings.caseSensitive = raw.caseSensitive;
  if (raw.listOrder === "fixed" || raw.listOrder === "any") settings.listOrder = raw.listOrder;
  const pinnedGaps = readList(raw.pinnedGaps, MAX_OWN_PINNED_GAPS, { exactCase: true });
  if (pinnedGaps) settings.pinnedGaps = pinnedGaps;
  const disabledModes = readModes(raw.disabledModes);
  if (disabledModes) settings.disabledModes = disabledModes;
  const mcqDistractors = readList(raw.mcqDistractors, MAX_OWN_WRONG_ANSWERS);
  if (mcqDistractors) settings.mcqDistractors = mcqDistractors;
  const mcqExplanations = readExplanations(raw.mcqExplanations);
  if (mcqExplanations) settings.mcqExplanations = mcqExplanations;
  return Object.keys(settings).length > 0 ? settings : undefined;
}

/** What the card editor shows of a card's settings. */
export type StudySettingsDraft = {
  acceptedAnswers: string[];
  wrongAnswers: string[];
  pinnedGaps: string[];
  /** Of `OWN_TOGGLEABLE_MODES`, the ones turned off. */
  disabledModes: StudyMode[];
};

export const EMPTY_STUDY_SETTINGS_DRAFT: StudySettingsDraft = {
  acceptedAnswers: [],
  wrongAnswers: [],
  pinnedGaps: [],
  disabledModes: [],
};

export function studySettingsDraftFrom(settings: CardStudySettings | undefined): StudySettingsDraft {
  return {
    acceptedAnswers: settings?.acceptedAnswers ?? [],
    wrongAnswers: settings?.mcqDistractors ?? [],
    pinnedGaps: settings?.pinnedGaps ?? [],
    disabledModes: (settings?.disabledModes ?? []).filter((mode) => OWN_TOGGLEABLE_MODES.includes(mode)),
  };
}

const sameList = <T,>(left: readonly T[], right: readonly T[]) =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

export function sameStudySettingsDraft(left: StudySettingsDraft, right: StudySettingsDraft) {
  return (
    sameList(left.acceptedAnswers, right.acceptedAnswers) &&
    sameList(left.wrongAnswers, right.wrongAnswers) &&
    sameList(left.pinnedGaps, right.pinnedGaps) &&
    sameList(readModes(left.disabledModes) ?? [], readModes(right.disabledModes) ?? [])
  );
}

const nonEmpty = (list: string[] | undefined) => (list && list.length > 0 ? list : undefined);

/**
 * The settings a card is saved with: the editor's draft over whatever else the
 * card already had, or undefined when nothing is left.
 *
 * A list emptied in the editor is left off rather than saved empty. Saved
 * empty, no wrong answers would tell Learn the author wants no multiple choice
 * at all, and turning a way of asking off is what the switches are for. Why a
 * wrong answer is wrong is kept only for wrong answers that are still there.
 */
export function applyStudySettingsDraft(
  previous: CardStudySettings | undefined,
  draft: StudySettingsDraft
): CardStudySettings | undefined {
  const wrongAnswers = nonEmpty(readList(draft.wrongAnswers, MAX_OWN_WRONG_ANSWERS));
  const kept = new Set(wrongAnswers ?? []);
  const explanations = Object.fromEntries(
    Object.entries(previous?.mcqExplanations ?? {}).filter(([option]) => kept.has(option))
  );
  const otherDisabled = (previous?.disabledModes ?? []).filter((mode) => !OWN_TOGGLEABLE_MODES.includes(mode));
  const disabled = [...otherDisabled, ...draft.disabledModes.filter((mode) => OWN_TOGGLEABLE_MODES.includes(mode))];
  return normalizeCardStudySettings({
    ...previous,
    acceptedAnswers: nonEmpty(readList(draft.acceptedAnswers, MAX_OWN_ACCEPTED_ANSWERS)),
    pinnedGaps: nonEmpty(readList(draft.pinnedGaps, MAX_OWN_PINNED_GAPS, { exactCase: true })),
    mcqDistractors: wrongAnswers,
    mcqExplanations: Object.keys(explanations).length > 0 ? explanations : undefined,
    disabledModes: disabled.length > 0 ? disabled : undefined,
    generatedStudy: undefined,
  });
}

/**
 * What an edit does to a card's settings: null when the student left them as
 * they were, so the card keeps exactly what it had -- and with it the
 * fingerprint its prepared questions are filed under -- or the settings to
 * save, undefined when none are left.
 */
export function studySettingsChange(
  saved: CardStudySettings | undefined,
  draft: StudySettingsDraft
): { next: CardStudySettings | undefined } | null {
  if (sameStudySettingsDraft(draft, studySettingsDraftFrom(saved))) return null;
  return { next: applyStudySettingsDraft(saved, draft) };
}
