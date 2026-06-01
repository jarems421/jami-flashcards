import { getCustomStudyHref } from "@/lib/app/routes";
import { buildTopicProgress, type TopicProgressSummary } from "@/lib/practice/progress";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Topic } from "@/lib/practice/topics";
import type { Goal } from "@/lib/study/goals";
import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Source } from "@/lib/practice/sources";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";

export type TodayNextActionType =
  | "create_first_deck"
  | "add_first_cards"
  | "review_due_cards"
  | "review_drafts"
  | "practice_weak_topic"
  | "continue_goal"
  | "continue_notebook"
  | "create_first_folder"
  | "focused_review";

export type TodayNextAction = {
  type: TodayNextActionType;
  title: string;
  description: string;
  href: string;
  label: string;
  priority: number;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export type TodayDueCardsSummary = {
  count: number;
  weakCount: number;
  primaryDeckId?: string;
  primaryDeckName?: string;
};

export type TodayWeakTopic = {
  topicId: string;
  name: string;
  subject: string;
  accuracy: number;
  reason: string;
  href: string;
};

export type TodayDraft = {
  id: string;
  front: string;
  back: string;
  suggestedTopic?: string;
  sourceId?: string;
  sourceTitle?: string;
  href: string;
};

export type TodayGoalSummary = {
  goalId: string;
  title: string;
  detail: string;
  progressPercent: number;
  href: string;
};

export type TodayChecklist = {
  createFolder: boolean;
  createDeck: boolean;
  addCards: boolean;
  reviewCards: boolean;
  createNotebook: boolean;
  reviewDrafts: boolean;
  checkProgress: boolean;
};

export type TodayWorkspaceSummary = {
  folderCount: number;
  notebookCount: number;
  sourceCount: number;
  recentNotebook?: {
    id: string;
    title: string;
    folderId: string;
    href: string;
  };
};

export type TodayPlan = {
  nextAction: TodayNextAction;
  dueCards: TodayDueCardsSummary;
  weakTopics: TodayWeakTopic[];
  drafts: TodayDraft[];
  goalSummary?: TodayGoalSummary;
  workspace: TodayWorkspaceSummary;
  checklist: TodayChecklist;
  topicProgress: TopicProgressSummary[];
};

type TodayDeckInput = {
  id: string;
  name: string;
};

type TodayDraftInput = {
  id: string;
  kind: string;
  contentStatus: string;
  front?: string;
  back?: string;
  questionText?: string;
  answerText?: string;
  topicIds?: string[];
  sourceType?: string;
  sourceId?: string;
};

export type BuildTodayPlanInput = {
  decks: TodayDeckInput[];
  cards: Card[];
  dueCards?: Card[];
  topics: Topic[];
  masteryEvents: MasteryEvent[];
  drafts: TodayDraftInput[];
  sources?: Source[];
  studyFolders?: StudyFolder[];
  notebooks?: Notebook[];
  activeGoals?: Goal[];
  reviewedToday?: number;
  progressVisited?: boolean;
  now?: number;
};

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getDeckName(decks: TodayDeckInput[], deckId: string | undefined) {
  if (!deckId) return undefined;
  return decks.find((deck) => deck.id === deckId)?.name;
}

function getPrimaryDeckId(cards: Card[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
}

function getTopicHref(topicId: string) {
  return `/dashboard/folders?topic=${encodeURIComponent(topicId)}`;
}

function getNotebookHref(notebookId: string) {
  return `/dashboard/notebooks/${encodeURIComponent(notebookId)}`;
}

function buildDueSummary(input: BuildTodayPlanInput, now: number): TodayDueCardsSummary {
  const dueCards =
    input.dueCards ??
    input.cards.filter((card) => typeof card.dueDate === "number" && card.dueDate <= now);
  const weakCards = input.cards.filter((card) => getMemoryRiskInfo(card, now).tier === "high");
  const primaryDeckId = getPrimaryDeckId(dueCards);

  return {
    count: dueCards.length,
    weakCount: weakCards.length,
    primaryDeckId,
    primaryDeckName: getDeckName(input.decks, primaryDeckId),
  };
}

function buildDrafts(input: BuildTodayPlanInput): TodayDraft[] {
  const topicsById = new Map(input.topics.map((topic) => [topic.id, topic]));
  const sourcesById = new Map((input.sources ?? []).map((source) => [source.id, source]));

  return input.drafts
    .filter((draft) => draft.contentStatus === "draft")
    .map((draft) => {
      const source = draft.sourceId ? sourcesById.get(draft.sourceId) : undefined;
      const isFlashcard = draft.kind === "flashcard";
      return {
        id: draft.id,
        front: isFlashcard
          ? draft.front?.trim() || "Untitled flashcard draft"
          : draft.questionText?.trim() || "Question notebook page draft",
        back: isFlashcard
          ? draft.back?.trim() || "No answer yet"
          : draft.answerText?.trim() || "Approve into a notebook page before working.",
        suggestedTopic: draft.topicIds?.map((topicId) => topicsById.get(topicId)?.name).find(Boolean),
        sourceId: draft.sourceId,
        sourceTitle: source?.title,
        href: draft.sourceType === "source" ? "/dashboard/library" : "/dashboard/progress",
      };
    })
    .slice(0, 4);
}

function buildWeakTopics(input: BuildTodayPlanInput, now: number) {
  const topicProgress = buildTopicProgress({
    topics: input.topics,
    cards: input.cards,
    masteryEvents: input.masteryEvents,
    sources: input.sources,
    notebooks: input.notebooks,
    studyFolders: input.studyFolders,
    now,
  });

  const weakTopics = topicProgress
    .filter(
      (summary) =>
        summary.weakCardCount > 0 ||
        summary.dueCardCount > 0 ||
        summary.masteryScore < 0 ||
        summary.notebookCount > 0
    )
    .map((summary) => {
      let reason = "Open the linked folder, continue a notebook page, then review related cards.";
      if (summary.weakCardCount > 0) {
        reason = `${pluralize(summary.weakCardCount, "weak card")} linked to this topic.`;
      } else if (summary.dueCardCount > 0) {
        reason = `${pluralize(summary.dueCardCount, "due card")} linked to this topic.`;
      } else if (summary.notebookCount > 0) {
        reason = `${pluralize(summary.notebookCount, "notebook")} linked to this topic.`;
      }

      return {
        topicId: summary.topic.id,
        name: summary.topic.name,
        subject: summary.topic.subject,
        accuracy: summary.cardCount > 0 ? Math.max(0, 100 - summary.weakCardCount * 20) : 0,
        reason,
        href: getTopicHref(summary.topic.id),
      };
    })
    .slice(0, 3);

  return { topicProgress, weakTopics };
}

function buildGoalSummary(input: BuildTodayPlanInput, now: number): TodayGoalSummary | undefined {
  const goal = (input.activeGoals ?? [])
    .filter((item) => item.status === "active" && item.deadline > now)
    .sort((left, right) => left.deadline - right.deadline)[0];

  if (!goal) return undefined;

  const progressPercent =
    goal.targetCards > 0
      ? Math.min(100, Math.round((goal.progress.cardsCompleted / goal.targetCards) * 100))
      : 0;

  return {
    goalId: goal.id,
    title: `Review ${pluralize(goal.targetCards, "card")} for this goal.`,
    detail: `${goal.progress.cardsCompleted} / ${goal.targetCards} cards complete.`,
    progressPercent,
    href: "/dashboard/goals",
  };
}

function buildWorkspaceSummary(input: BuildTodayPlanInput): TodayWorkspaceSummary {
  const recentNotebook = (input.notebooks ?? [])
    .filter((notebook) => !notebook.archived)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  return {
    folderCount: (input.studyFolders ?? []).filter((folder) => !folder.archived).length,
    notebookCount: (input.notebooks ?? []).filter((notebook) => !notebook.archived).length,
    sourceCount: (input.sources ?? []).filter((source) => source.status === "active").length,
    recentNotebook: recentNotebook
      ? {
          id: recentNotebook.id,
          title: recentNotebook.title,
          folderId: recentNotebook.folderId,
          href: getNotebookHref(recentNotebook.id),
        }
      : undefined,
  };
}

function buildChecklist(input: BuildTodayPlanInput): TodayChecklist {
  return {
    createFolder: (input.studyFolders ?? []).some((folder) => !folder.archived),
    createDeck: input.decks.length > 0,
    addCards: input.cards.length >= 5,
    reviewCards: (input.reviewedToday ?? 0) > 0,
    createNotebook: (input.notebooks ?? []).some((notebook) => !notebook.archived),
    reviewDrafts: input.drafts.some((draft) => draft.contentStatus === "draft"),
    checkProgress: input.progressVisited === true,
  };
}

function buildNextAction(input: {
  decks: TodayDeckInput[];
  cards: Card[];
  dueCards: TodayDueCardsSummary;
  drafts: TodayDraft[];
  weakTopics: TodayWeakTopic[];
  goalSummary?: TodayGoalSummary;
  workspace: TodayWorkspaceSummary;
}): TodayNextAction {
  if (input.workspace.folderCount === 0) {
    return {
      type: "create_first_folder",
      title: "Create your first study folder.",
      description: "Folders are where notebooks, decks, and sources come together.",
      href: "/dashboard/folders",
      label: "Create folder",
      priority: 1,
    };
  }

  if (input.workspace.recentNotebook) {
    return {
      type: "continue_notebook",
      title: `Continue ${input.workspace.recentNotebook.title}.`,
      description: "Open the latest notebook page and keep working naturally.",
      href: input.workspace.recentNotebook.href,
      label: "Continue notebook",
      priority: 2,
      secondaryHref: "/dashboard/folders",
      secondaryLabel: "Open folders",
    };
  }

  if (input.dueCards.count > 0) {
    const deckText = input.dueCards.primaryDeckName ? ` in ${input.dueCards.primaryDeckName}` : "";
    return {
      type: "review_due_cards",
      title: `Review ${pluralize(input.dueCards.count, "due flashcard")}${deckText}.`,
      description: "Due cards are time-sensitive. Review them, then return to notebook work.",
      href: getCustomStudyHref({ mode: "daily" }),
      label: "Start review",
      priority: 3,
      secondaryHref: "/dashboard/folders",
      secondaryLabel: "Open folders",
    };
  }

  if (input.drafts.length > 0) {
    return {
      type: "review_drafts",
      title: `Review ${pluralize(input.drafts.length, "draft")}.`,
      description: "Generated drafts stay separate until you approve them into Learn or a notebook.",
      href: input.drafts[0]?.href ?? "/dashboard/library",
      label: "Review drafts",
      priority: 4,
    };
  }

  if (input.weakTopics.length > 0) {
    const topic = input.weakTopics[0];
    return {
      type: "practice_weak_topic",
      title: `Open work linked to ${topic.name}.`,
      description: topic.reason,
      href: topic.href,
      label: "Open folder",
      priority: 5,
      secondaryHref: "/dashboard/study",
      secondaryLabel: "Review linked cards",
    };
  }

  if (input.goalSummary) {
    return {
      type: "continue_goal",
      title: "Keep your current goal moving.",
      description: input.goalSummary.detail,
      href: input.goalSummary.href,
      label: "Open goal",
      priority: 6,
    };
  }

  if (input.decks.length === 0) {
    return {
      type: "create_first_deck",
      title: "Create your first flashcard deck.",
      description: "Decks still power quick review, especially on mobile.",
      href: "/dashboard/decks",
      label: "Create deck",
      priority: 7,
    };
  }

  if (input.cards.length === 0) {
    return {
      type: "add_first_cards",
      title: "Add your first flashcards.",
      description: "Your workspace is ready. Add a few cards so Jami can schedule reviews.",
      href: "/dashboard/cards",
      label: "Add cards",
      priority: 8,
      secondaryHref: "/dashboard/decks",
      secondaryLabel: "Open decks",
    };
  }

  return {
    type: "focused_review",
    title: "Choose a focused study session.",
    description: "Open a notebook, review cards, or organise a folder.",
    href: getCustomStudyHref({ mode: "custom" }),
    label: "Focused review",
    priority: 9,
    secondaryHref: "/dashboard/folders",
    secondaryLabel: "Open folders",
  };
}

export function buildTodayPlan(input: BuildTodayPlanInput): TodayPlan {
  const now = input.now ?? Date.now();
  const dueCards = buildDueSummary(input, now);
  const drafts = buildDrafts(input);
  const { topicProgress, weakTopics } = buildWeakTopics(input, now);
  const goalSummary = buildGoalSummary(input, now);
  const workspace = buildWorkspaceSummary(input);
  const checklist = buildChecklist(input);
  const nextAction = buildNextAction({
    decks: input.decks,
    cards: input.cards,
    dueCards,
    drafts,
    weakTopics,
    goalSummary,
    workspace,
  });

  return {
    nextAction,
    dueCards,
    weakTopics,
    drafts,
    goalSummary,
    workspace,
    checklist,
    topicProgress,
  };
}
