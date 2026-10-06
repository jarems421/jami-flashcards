import type { Card } from "@/lib/study/cards";
import type { DailyReviewState } from "@/lib/study/daily-review-types";
import { getTopicNameKey, type Topic } from "@/lib/material/topics";
import {
  canRestorePersistedSession,
  hydratePersistedSessionCards,
  isIncomingSessionNewer,
  type PersistedStudySession,
} from "@/lib/study/session";

/** What the server said about the student's active session. */
export type RemoteStudySessionState = {
  session: PersistedStudySession | null;
  closedSession?: PersistedStudySession | null;
  foundRemoteSession: boolean;
};

/**
 * What to do with a session found on opening Learn.
 *
 * `closedElsewhere` is a session another device has closed, which this device
 * remembers so the copy it holds is never resumed.
 */
export type StudySessionRestorePlan =
  /** Nothing to resume; anything saved here is left as it is. */
  | { kind: "none"; closedElsewhere?: PersistedStudySession }
  /** The session saved here was closed somewhere: forget it. */
  | { kind: "discard"; closedElsewhere?: PersistedStudySession }
  /** The saved session has nothing left to answer: close it as completed. */
  | { kind: "close-finished"; session: PersistedStudySession }
  | { kind: "resume"; session: PersistedStudySession; cards: Card[]; index: number };

/** The server's closed copy of this same session, when it is newer than this one. */
function closedLaterElsewhere(
  session: PersistedStudySession | null,
  closed: PersistedStudySession | null
) {
  return closed && session && closed.sessionId === session.sessionId && isIncomingSessionNewer(session, closed)
    ? closed
    : null;
}

/**
 * Sessions saved before Topics existed named their filters as tags. They are
 * matched to Topics by name, and any that no longer match are dropped.
 */
function withLegacyTagsAsTopics(session: PersistedStudySession, topics: Topic[]): PersistedStudySession {
  if (session.selectedTopicIds.length > 0 || !session.legacySelectedTags?.length) return session;
  const selectedTopicIds = session.legacySelectedTags
    .map(
      (legacyTag) =>
        topics.find((topic) => getTopicNameKey(topic.name) === getTopicNameKey(legacyTag))?.id
    )
    .filter((topicId): topicId is string => Boolean(topicId));
  return { ...session, selectedTopicIds, legacySelectedTags: undefined };
}

/**
 * Decide whether Learn opens on a session already in progress.
 *
 * The newer of this device's copy and the server's wins. The server never holds
 * draft answers, so those come from this device whenever both copies are the
 * same session. A session closed anywhere -- on the server, or by a tombstone
 * left here -- is never resumed, and one that does not match what the link
 * asked for is left for later rather than thrown away.
 */
export function planStudySessionRestore({
  localSession,
  remote,
  isClosedHere,
  request,
  topics,
  cards,
  dailyReviewState,
}: {
  localSession: PersistedStudySession | null;
  remote: RemoteStudySessionState;
  /** Whether this device already closed the session at that revision. */
  isClosedHere: (session: PersistedStudySession) => boolean;
  request: { mode: "custom" | "daily" | null; deckIds: string[]; topicIds: string[] };
  topics: Topic[];
  cards: Card[];
  dailyReviewState: DailyReviewState | null;
}): StudySessionRestorePlan {
  const remoteSession = remote.session;
  const remoteClosed = remote.closedSession ?? null;

  let session = localSession;
  if (remoteSession && (!session || isIncomingSessionNewer(session, remoteSession))) {
    session = remoteSession;
  }
  if (session && localSession?.sessionId === session.sessionId) {
    session = { ...session, draftResponses: localSession.draftResponses };
  }
  if (session) session = withLegacyTagsAsTopics(session, topics);
  const closedLater = closedLaterElsewhere(session, remoteClosed);

  if (remote.foundRemoteSession && !remoteSession) {
    if (closedLater) return { kind: "discard", closedElsewhere: closedLater };
    if (!session) return { kind: "discard" };
    // The server holds a different session, already closed. Remember it, and
    // leave this device's own copy alone.
    return remoteClosed && remoteClosed.sessionId !== session.sessionId
      ? { kind: "none", closedElsewhere: remoteClosed }
      : { kind: "none" };
  }

  if (closedLater) return { kind: "discard", closedElsewhere: closedLater };
  if (session && isClosedHere(session)) return { kind: "discard" };
  if (!session || !canRestorePersistedSession(session, request.mode, request.deckIds, request.topicIds)) {
    return { kind: "none" };
  }

  const restored = hydratePersistedSessionCards(session, cards, dailyReviewState);
  if (restored.cards.length === 0 || restored.index >= restored.cards.length) {
    return { kind: "close-finished", session };
  }
  return { kind: "resume", session, cards: restored.cards, index: restored.index };
}
