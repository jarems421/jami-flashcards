"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parseIdsParam } from "@/lib/study/focused-review";
import { readStudySessionShape, type StudySessionShape } from "@/lib/study/session-spec-queue";

export type StudyRequestedMode = "custom" | "daily";

/** What the link that opened Learn asked for. */
export type StudyRequest = {
  mode: StudyRequestedMode | null;
  deckIds: string[];
  topicIds: string[];
  /** Filters from links made before Topics existed, matched to Topics by name. */
  legacyTags: string[];
  /** Whether the link asked for Focused Review in any way. */
  wantsFocusedReview: boolean;
  /**
   * What the Learning Engine asked this session to do, when it opened it.
   *
   * Null for a student who opened Learn themselves, and the queue is then the
   * ordinary scheduler one -- they are not carrying out a recommendation, so
   * nothing should be narrowed or cut short on their behalf.
   */
  sessionShape: StudySessionShape | null;
  /** The recommendation this session carries out, when one opened it. */
  fromActionId: string | null;
};

export function useStudyRequest(): StudyRequest {
  const searchParams = useSearchParams();
  const rawMode = searchParams.get("mode");
  const rawDecks = searchParams.get("decks");
  const rawTopics = searchParams.get("topics");
  const rawTags = searchParams.get("tags");
  const rawFocus = searchParams.get("focus");
  const rawFocusCount = searchParams.get("focusCount");
  const fromActionId = searchParams.get("from");

  const mode = rawMode === "custom" || rawMode === "daily" ? rawMode : null;
  const deckIds = useMemo(() => parseIdsParam(rawDecks), [rawDecks]);
  const topicIds = useMemo(() => parseIdsParam(rawTopics), [rawTopics]);
  const legacyTags = useMemo(() => parseIdsParam(rawTags), [rawTags]);
  const sessionShape = useMemo(
    () => readStudySessionShape(rawFocus, rawFocusCount),
    [rawFocus, rawFocusCount]
  );

  return {
    mode,
    deckIds,
    topicIds,
    legacyTags,
    wantsFocusedReview:
      mode === "custom" || deckIds.length > 0 || topicIds.length > 0 || legacyTags.length > 0,
    sessionShape,
    fromActionId,
  };
}
