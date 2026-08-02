import type { Feedback } from "@/lib/app/feedback";
import { getStudyDayKey } from "@/lib/study/day";
import type { DailyStudyActivity } from "@/lib/study/activity";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import type { Goal } from "@/lib/study/goals";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { MasteryEvent } from "@/lib/material/mastery";
import type { Source } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { loadInAppUsername } from "@/services/profile";
import { loadDashboardStudyActivity } from "@/services/study/activity";
import { loadUserCards } from "@/services/study/cards";
import {
  ensureDailyReviewState,
  ensureStudyStateSetup,
} from "@/services/study/daily-review";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFoldersPage } from "@/services/study/folders";
import { getPendingGeneratedContentDrafts } from "@/services/study/generated-content";
import { getDashboardGoalSummary } from "@/services/study/goals";
import { getMasteryEvents } from "@/services/study/mastery";
import { getRecentActiveNotebooks } from "@/services/study/notebooks";
import { loadRemoteActiveStudySession } from "@/services/study/session";
import { getActiveSourcesForDashboard } from "@/services/study/sources";
import { getActiveTopics } from "@/services/study/topics";
import {
  clearDashboardInFlight,
  getDashboardCacheEntry,
  getDashboardCacheRevision,
  getDashboardInFlight,
  setDashboardCacheEntry,
  setDashboardInFlight,
} from "@/services/dashboard/cache";

export const DASHBOARD_FRESH_MS = 60_000;
export const DASHBOARD_STALE_MS = 5 * 60_000;

export type DashboardSectionState = "ready" | "stale" | "unavailable";

export type DashboardSection =
  | "decks"
  | "profile"
  | "cards"
  | "session"
  | "goals"
  | "activity"
  | "topics"
  | "mastery"
  | "drafts"
  | "sources"
  | "folders"
  | "notebooks"
  | "dailyReview";

export type DashboardSnapshot = {
  fetchedAt: number;
  sections: Record<DashboardSection, DashboardSectionState>;
  decks: Deck[];
  dueCards: Card[];
  remainingOptionalCount: number;
  activeGoals: Goal[];
  hasEarnedStars: boolean;
  studyActivity: DailyStudyActivity[];
  cards: Card[];
  topics: Topic[];
  masteryEvents: MasteryEvent[];
  drafts: GeneratedContentDraft[];
  sources: Source[];
  studyFolders: StudyFolder[];
  notebooks: Notebook[];
  username: string | null;
  hasActiveStudySession: boolean;
};

export type DashboardLoadResult = {
  snapshot: DashboardSnapshot;
  feedback: Feedback | null;
};

export type DashboardCachedSnapshot = {
  snapshot: DashboardSnapshot;
  freshness: "fresh" | "stale";
};

type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

async function settle<T>(request: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await request };
  } catch (error) {
    return { ok: false, error };
  }
}

function resolveSection<T>(input: {
  result: Settled<T>;
  previous: T | undefined;
  empty: T;
}) {
  if (input.result.ok) {
    return { value: input.result.value, state: "ready" as const };
  }
  if (input.previous !== undefined) {
    return { value: input.previous, state: "stale" as const };
  }
  return { value: input.empty, state: "unavailable" as const };
}

/**
 * What a student would call each section, so the banner can say what is
 * missing. "One section" is accurate and useless: it is the same sentence
 * whether their notebooks failed or their goals did.
 */
const SECTION_LABELS: Record<keyof DashboardSnapshot["sections"], string> = {
  decks: "your decks",
  profile: "your profile",
  cards: "your cards",
  session: "your study session",
  goals: "your goals",
  activity: "your activity",
  topics: "your topics",
  mastery: "your progress",
  drafts: "your drafts",
  sources: "your sources",
  folders: "your folders",
  notebooks: "your notebooks",
  dailyReview: "Daily Review",
};

function describeFailedSections(failedSections: string[]) {
  const labels = failedSections.map(
    (section) =>
      SECTION_LABELS[section as keyof DashboardSnapshot["sections"]] ?? section
  );

  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  // Past two it stops being a useful sentence and becomes a list to scan.
  return `${labels.length} sections`;
}

async function fetchDashboardSnapshot(
  userId: string,
  previous?: DashboardSnapshot
): Promise<DashboardLoadResult> {
  await ensureStudyStateSetup(userId);
  const now = Date.now();

  const [
    decksResult,
    usernameResult,
    cardsResult,
    sessionResult,
    goalsResult,
    activityResult,
    topicsResult,
    masteryResult,
    draftsResult,
    foldersResult,
    notebooksResult,
  ] = await Promise.all([
    settle(getDecks(userId)),
    settle(loadInAppUsername(userId)),
    settle(loadUserCards(userId)),
    settle(loadRemoteActiveStudySession(userId, getStudyDayKey(now), now)),
    settle(getDashboardGoalSummary(userId, now)),
    settle(loadDashboardStudyActivity(userId)),
    settle(getActiveTopics(userId)),
    settle(getMasteryEvents(userId)),
    settle(getPendingGeneratedContentDrafts(userId, 4)),
    settle(
      getActiveStudyFoldersPage(userId, { pageSize: 1 }).then(
        (page) => page.items
      )
    ),
    settle(getRecentActiveNotebooks(userId, 1)),
  ]);
  const sourcesResult =
    !draftsResult.ok && previous
      ? ({ ok: false, error: draftsResult.error } as const)
      : await settle(
          getActiveSourcesForDashboard(
            userId,
            (draftsResult.ok ? draftsResult.value : [])
              .map((draft) => draft.sourceId)
              .filter((sourceId): sourceId is string => Boolean(sourceId))
          )
        );

  const decks = resolveSection({
    result: decksResult,
    previous: previous?.decks,
    empty: [] as Deck[],
  });
  const username = resolveSection({
    result: usernameResult,
    previous: previous?.username,
    empty: null,
  });
  const cards = resolveSection({
    result: cardsResult,
    previous: previous?.cards,
    empty: [] as Card[],
  });
  const sessionState: DashboardSectionState = sessionResult.ok
    ? "ready"
    : previous
      ? "stale"
      : "unavailable";
  const goalsState: DashboardSectionState = goalsResult.ok
    ? "ready"
    : previous
      ? "stale"
      : "unavailable";
  const activity = resolveSection({
    result: activityResult,
    previous: previous?.studyActivity,
    empty: [] as DailyStudyActivity[],
  });
  const topics = resolveSection({
    result: topicsResult,
    previous: previous?.topics,
    empty: [] as Topic[],
  });
  const mastery = resolveSection({
    result: masteryResult,
    previous: previous?.masteryEvents,
    empty: [] as MasteryEvent[],
  });
  const drafts = resolveSection({
    result: draftsResult,
    previous: previous?.drafts,
    empty: [] as GeneratedContentDraft[],
  });
  const sources = resolveSection({
    result: sourcesResult,
    previous: previous?.sources,
    empty: [] as Source[],
  });
  const folders = resolveSection({
    result: foldersResult,
    previous: previous?.studyFolders,
    empty: [] as StudyFolder[],
  });
  const notebooks = resolveSection({
    result: notebooksResult,
    previous: previous?.notebooks,
    empty: [] as Notebook[],
  });

  let dueCards = previous?.dueCards ?? [];
  let remainingOptionalCount = previous?.remainingOptionalCount ?? 0;
  let dailyReviewState: DashboardSectionState =
    cards.state === "ready" && sessionState === "ready"
      ? "ready"
      : previous
        ? "stale"
        : "unavailable";

  if (cards.state !== "unavailable" && sessionResult.ok) {
    try {
      const reviewState = await ensureDailyReviewState(userId, cards.value, now, {
        activeSession:
          sessionResult.ok && "session" in sessionResult.value
            ? sessionResult.value.session
            : null,
      });
      const completedRequiredIds = new Set(reviewState.completedRequiredCardIds);
      const parkedRequiredIds = new Set(reviewState.parkedRequiredCardIds);
      const completedOptionalIds = new Set(reviewState.completedOptionalCardIds);
      const cardsById = new Map(cards.value.map((card) => [card.id, card]));
      dueCards = reviewState.requiredCardIds
        .map((cardId) => cardsById.get(cardId) ?? null)
        .filter((card): card is Card => card !== null)
        .filter(
          (card) =>
            !completedRequiredIds.has(card.id) &&
            !parkedRequiredIds.has(card.id)
        );
      remainingOptionalCount = reviewState.optionalCardIds.filter(
        (cardId) => cardsById.has(cardId) && !completedOptionalIds.has(cardId)
      ).length;
      dailyReviewState = cards.state === "ready" ? "ready" : "stale";
    } catch (error) {
      console.warn("Failed to refresh Today review queues.", error);
      dailyReviewState = previous ? "stale" : "unavailable";
    }
  }

  const goalSummary = goalsResult.ok
    ? goalsResult.value
    : {
        activeGoals: previous?.activeGoals ?? [],
        hasEarnedStars: previous?.hasEarnedStars ?? false,
      };

  const sections: DashboardSnapshot["sections"] = {
    decks: decks.state,
    profile: username.state,
    cards: cards.state,
    session: sessionState,
    goals: goalsState,
    activity: activity.state,
    topics: topics.state,
    mastery: mastery.state,
    drafts: drafts.state,
    sources: sources.state,
    folders: folders.state,
    notebooks: notebooks.state,
    dailyReview: dailyReviewState,
  };
  const failedSections = Object.entries(sections)
    .filter(([, state]) => state !== "ready")
    .map(([section]) => section);

  if (failedSections.length > 0) {
    // Today loads thirteen sections independently, so a count on its own
    // leaves no way to tell which one is broken -- from either the banner or
    // the console.
    console.warn("Today sections did not refresh.", {
      failedSections: failedSections.map(
        (section) => `${section}:${sections[section as keyof typeof sections]}`
      ),
    });
  }

  const snapshot: DashboardSnapshot = {
    fetchedAt: Date.now(),
    sections,
    decks: decks.value,
    dueCards,
    remainingOptionalCount,
    activeGoals: goalSummary.activeGoals,
    hasEarnedStars: goalSummary.hasEarnedStars,
    studyActivity: activity.value,
    cards: cards.value,
    topics: topics.value,
    masteryEvents: mastery.value,
    drafts: drafts.value,
    sources: sources.value,
    studyFolders: folders.value,
    notebooks: notebooks.value,
    username: username.value,
    hasActiveStudySession: sessionResult.ok
      ? Boolean(sessionResult.value.session)
      : previous?.hasActiveStudySession ?? false,
  };

  return {
    snapshot,
    feedback:
      failedSections.length > 0
        ? {
            type: "error",
            message: `Today could not refresh ${describeFailedSections(failedSections)}. Existing information is shown where available.`,
          }
        : null,
  };
}

export function getCachedDashboardSnapshot(
  userId: string,
  now = Date.now()
): DashboardCachedSnapshot | null {
  const entry = getDashboardCacheEntry<DashboardSnapshot>(userId);
  if (!entry) return null;
  const age = now - entry.fetchedAt;
  if (age > DASHBOARD_STALE_MS) return null;
  return {
    snapshot: entry.value,
    freshness:
      age <= DASHBOARD_FRESH_MS &&
      !entry.hasDegradedSections &&
      !entry.invalidated
        ? "fresh"
        : "stale",
  };
}

export async function loadDashboardSnapshot(
  userId: string,
  options: { force?: boolean } = {}
) {
  const cached = getCachedDashboardSnapshot(userId);
  if (!options.force && cached?.freshness === "fresh") {
    return { snapshot: cached.snapshot, feedback: null };
  }

  const existing = getDashboardInFlight<DashboardLoadResult>(userId);
  if (existing) return existing;

  // Values older than the five-minute display window must not be revived by
  // another failed refresh.
  const previousEntry = getDashboardCacheEntry<DashboardSnapshot>(userId);
  const previous = cached?.snapshot;
  const revisionAtStart = getDashboardCacheRevision(userId);
  const request = fetchDashboardSnapshot(userId, previous).then((result) => {
    const hasDegradedSections = Object.values(result.snapshot.sections).some(
      (state) => state !== "ready"
    );
    setDashboardCacheEntry(userId, {
      value: result.snapshot,
      // A failed refresh may update some sections, but it must not make stale
      // fallback values young again or extend them indefinitely.
      fetchedAt:
        hasDegradedSections && previous
          ? previousEntry?.fetchedAt ?? previous.fetchedAt
          : result.snapshot.fetchedAt,
      hasDegradedSections,
      invalidated: getDashboardCacheRevision(userId) !== revisionAtStart,
    });
    return result;
  });
  setDashboardInFlight(userId, request);
  void request.then(
    () => clearDashboardInFlight(userId, request),
    () => clearDashboardInFlight(userId, request)
  );
  return request;
}
