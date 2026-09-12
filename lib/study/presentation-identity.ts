/**
 * One identity per presentation of a card, minted once and then kept.
 *
 * An interactive exercise carries a saved `presentationId`. Classic has no
 * saved exercise to carry one, so it used to build its commit id from an
 * in-memory presentation counter that resets on reload. A repeated card -- a
 * one-card Simple Study session most of all -- could then rebuild an earlier id
 * after a refresh, and its receipt would suppress a genuinely new answer as a
 * duplicate of the old one.
 *
 * So the id is stored beside the drafts, which already survive a refresh and
 * already carry the retirement flags. A reload resumes the same commit rather
 * than recomputing one, which is exactly what a half-finished save needs.
 */

/** Drafts hold gap maps as well as strings, and only a string is an id. */
type DraftValue = string | Record<string, string> | undefined;

export function presentationDraftKey(input: {
  sessionId: string;
  index: number;
  cardId: string;
  presentation: number;
}) {
  return `presentation:${input.sessionId}:${input.index}:${input.cardId}:${input.presentation}`;
}

/** The key under which a presentation records that it has been counted once. */
export function countedDraftKey(commitId: string) {
  return `counted:${commitId}`;
}

export function resolvePresentationId(input: {
  /** An exercise's own id, where one exists. Always wins: it is already saved. */
  pinnedId?: string;
  exerciseId?: string;
  /** Whatever the drafts already hold under `presentationDraftKey`. */
  stored: DraftValue;
  sessionId: string;
  index: number;
  cardId: string;
  newId: () => string;
}): { commitId: string; persist: boolean } {
  const carried = input.pinnedId ?? input.exerciseId;
  if (carried) return { commitId: carried, persist: false };
  const stored = typeof input.stored === "string" && input.stored ? input.stored : undefined;
  if (stored) return { commitId: stored, persist: false };
  return {
    commitId: `${input.sessionId}:${input.index}:${input.cardId}:${input.newId()}`,
    persist: true,
  };
}
