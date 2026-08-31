export const TUTORIAL_VERSION = 1;
export const TUTORIAL_ACTION_EVENT = "jami:tutorial-action";

export type TutorialStatus =
  | "idle"
  | "active"
  | "paused"
  | "completed"
  | "dismissed";

export type TutorialMissionId =
  | "create-folder"
  | "create-notebook"
  | "save-work"
  | "create-deck"
  | "create-card"
  | "complete-review"
  | "ask-tutor";

export type TutorialContext = {
  folderId?: string;
  notebookId?: string;
  deckId?: string;
};

export type TutorialRewardState = "not-earned" | "pending" | "awarded";

export type TutorialProgress = {
  version: typeof TUTORIAL_VERSION;
  status: TutorialStatus;
  currentMissionId: TutorialMissionId;
  completedMissionIds: TutorialMissionId[];
  context: TutorialContext;
  rewardState: TutorialRewardState;
  updatedAt: number;
};

export type TutorialMission = {
  id: TutorialMissionId;
  title: string;
  detail: string;
  actionLabel: string;
  href: (context: TutorialContext) => string;
};

type TutorialInvitationSectionState = "ready" | "stale" | "unavailable";

type TutorialInvitationInput = {
  isLoading: boolean;
  sectionStates: {
    decks: TutorialInvitationSectionState;
    cards: TutorialInvitationSectionState;
    activity: TutorialInvitationSectionState;
    folders: TutorialInvitationSectionState;
    notebooks: TutorialInvitationSectionState;
  };
  deckCount: number;
  cardCount: number;
  activityCount: number;
  folderCount: number;
  notebookCount: number;
};

/**
 * Whether Today has enough trustworthy evidence to call an account empty.
 *
 * Failed dashboard reads deliberately resolve to empty arrays so the rest of
 * Today can render. Those placeholders must not be mistaken for a brand-new
 * account, or a returning student can be welcomed into the first-run flow
 * during a transient outage.
 */
export function shouldInviteToTutorial({
  isLoading,
  sectionStates,
  deckCount,
  cardCount,
  activityCount,
  folderCount,
  notebookCount,
}: TutorialInvitationInput) {
  if (isLoading) return false;
  if (Object.values(sectionStates).some((state) => state === "unavailable")) {
    return false;
  }
  return (
    deckCount === 0 &&
    cardCount === 0 &&
    activityCount === 0 &&
    folderCount === 0 &&
    notebookCount === 0
  );
}

export const TUTORIAL_MISSIONS: readonly TutorialMission[] = [
  {
    id: "create-folder",
    title: "Give a subject a home",
    detail: "Create one folder for the subject you want to study.",
    actionLabel: "Create a folder",
    href: () => "/dashboard/practice",
  },
  {
    id: "create-notebook",
    title: "Open a place to work",
    detail: "Create a notebook inside that folder.",
    actionLabel: "Create a notebook",
    href: (context) =>
      context.folderId
        ? `/dashboard/folders/${encodeURIComponent(context.folderId)}`
        : "/dashboard/practice",
  },
  {
    id: "save-work",
    title: "Put something on the page",
    detail: "Write, type, or draw something useful and let it save.",
    actionLabel: "Open notebook",
    href: (context) =>
      context.notebookId
        ? `/dashboard/notebooks/${encodeURIComponent(context.notebookId)}`
        : "/dashboard/practice",
  },
  {
    id: "create-deck",
    title: "Make a place for memory",
    detail: "Create a flashcard deck for what matters.",
    actionLabel: "Create a deck",
    href: () => "/dashboard/decks",
  },
  {
    id: "create-card",
    title: "Keep one useful idea",
    detail: "Add one clear question and answer to the deck.",
    actionLabel: "Add a card",
    href: (context) =>
      context.deckId
        ? `/dashboard/decks/${encodeURIComponent(context.deckId)}`
        : "/dashboard/decks",
  },
  {
    id: "complete-review",
    title: "Bring it back once",
    detail: "Complete one real flashcard review.",
    actionLabel: "Start review",
    href: () => "/dashboard/study",
  },
  {
    id: "ask-tutor",
    title: "Ask beside your work",
    detail: "Open your notebook and ask Jami one question.",
    actionLabel: "Open notebook",
    href: (context) =>
      context.notebookId
        ? `/dashboard/notebooks/${encodeURIComponent(context.notebookId)}`
        : "/dashboard/tutor",
  },
] as const;

const missionIds = new Set<TutorialMissionId>(
  TUTORIAL_MISSIONS.map((mission) => mission.id)
);

export function createInitialTutorialProgress(
  status: TutorialStatus = "idle"
): TutorialProgress {
  return {
    version: TUTORIAL_VERSION,
    status,
    currentMissionId: TUTORIAL_MISSIONS[0].id,
    completedMissionIds: [],
    context: {},
    rewardState: "not-earned",
    updatedAt: Date.now(),
  };
}

export function normalizeTutorialProgress(value: unknown): TutorialProgress {
  const fallback = createInitialTutorialProgress();
  if (!value || typeof value !== "object") return fallback;
  const data = value as Record<string, unknown>;
  /*
   * A record written by a newer build describes missions this one has never
   * heard of. Reading it field by field would land the student mid-walkthrough
   * with the wrong mission marked current, so an unreadable version starts
   * clean instead of guessing. Older and unversioned records are readable:
   * every field below already tolerates what is missing from them.
   */
  const storedVersion = typeof data.version === "number" ? data.version : 0;
  if (storedVersion > TUTORIAL_VERSION) return fallback;
  const completedMissionIds = Array.isArray(data.completedMissionIds)
    ? Array.from(
        new Set(
          data.completedMissionIds.filter(
            (id): id is TutorialMissionId =>
              typeof id === "string" && missionIds.has(id as TutorialMissionId)
          )
        )
      )
    : [];
  const status = ["idle", "active", "paused", "completed", "dismissed"].includes(
    String(data.status)
  )
    ? (data.status as TutorialStatus)
    : "idle";
  const currentMissionId = missionIds.has(data.currentMissionId as TutorialMissionId)
    ? (data.currentMissionId as TutorialMissionId)
    : TUTORIAL_MISSIONS.find(
        (mission) => !completedMissionIds.includes(mission.id)
      )?.id ?? TUTORIAL_MISSIONS.at(-1)!.id;
  const rawContext =
    data.context && typeof data.context === "object"
      ? (data.context as Record<string, unknown>)
      : {};
  const readId = (key: string) =>
    typeof rawContext[key] === "string"
      ? (rawContext[key] as string).trim().slice(0, 160) || undefined
      : undefined;

  return {
    version: TUTORIAL_VERSION,
    status,
    currentMissionId,
    completedMissionIds,
    context: {
      folderId: readId("folderId"),
      notebookId: readId("notebookId"),
      deckId: readId("deckId"),
    },
    rewardState:
      data.rewardState === "pending" || data.rewardState === "awarded"
        ? data.rewardState
        : "not-earned",
    updatedAt:
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : fallback.updatedAt,
  };
}

export function getTutorialMission(id: TutorialMissionId) {
  return TUTORIAL_MISSIONS.find((mission) => mission.id === id)!;
}

export function advanceTutorialProgress(
  current: TutorialProgress,
  missionId: TutorialMissionId,
  context: TutorialContext = {}
): TutorialProgress {
  if (current.status !== "active") return current;
  if (current.completedMissionIds.includes(missionId)) return current;

  /*
   * Any real mission counts, not only the one being pointed at.
   *
   * A student who creates a deck while the card says "create a notebook" has
   * genuinely done that mission, and making them create a second deck later to
   * satisfy a checklist is the walkthrough arguing with the work. The missions
   * stay ordered -- the card still asks for the first one outstanding -- but
   * finishing them out of order skips ahead rather than being discarded.
   */
  const completedMissionIds = TUTORIAL_MISSIONS.map((mission) => mission.id).filter(
    (id) => id === missionId || current.completedMissionIds.includes(id)
  );
  const nextMission = TUTORIAL_MISSIONS.find(
    (mission) => !completedMissionIds.includes(mission.id)
  );
  const nextContext = { ...current.context };
  if (context.folderId) nextContext.folderId = context.folderId;
  if (context.notebookId) nextContext.notebookId = context.notebookId;
  if (context.deckId) nextContext.deckId = context.deckId;
  return {
    ...current,
    status: nextMission ? "active" : "completed",
    currentMissionId: nextMission?.id ?? current.currentMissionId,
    completedMissionIds,
    context: nextContext,
    updatedAt: Date.now(),
  };
}

export function reportTutorialAction(
  missionId: TutorialMissionId,
  context: TutorialContext = {}
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TUTORIAL_ACTION_EVENT, {
      detail: { missionId, context },
    })
  );
}
