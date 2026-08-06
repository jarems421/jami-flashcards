"use client";

import { useCallback, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import CardCreationPanel from "@/components/decks/CardCreationPanel";
import CardBrowserWorkspace from "@/components/cards/CardBrowserWorkspace";
import CardsGettingStarted from "@/components/cards/CardsGettingStarted";
import { useUser } from "@/components/providers/UserProvider";
import { Button, EmptyState, FeedbackBanner, SegmentedControl } from "@/components/ui";
import { FLASHCARD_VIEWS, FLASHCARDS_TITLE } from "@/lib/app/flashcard-views";
import {
  useDashboardData,
  type DashboardDataLoadOptions,
} from "@/hooks/useDashboardData";
import { useFeedback } from "@/hooks/useFeedback";
import type { Feedback } from "@/lib/app/feedback";
import { sortByCreatedAtNewest } from "@/lib/app/recent-items";
import type { Topic } from "@/lib/material/topics";
import type { Source } from "@/lib/material/sources";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import { loadUserCards } from "@/services/study/cards";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveSources } from "@/services/study/sources";
import { getActiveTopics } from "@/services/study/topics";

export default function CardsSearchPage() {
  const { user } = useUser();
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkTopicResetKey, setBulkTopicResetKey] = useState(0);
  const [hasSuccessfulLoad, setHasSuccessfulLoad] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const {
    feedback,
    success,
    showError,
    clear: clearFeedback,
  } = useFeedback();

  const handlePanelFeedback = useCallback(
    (next: Feedback) => {
      if (next.type === "success") success(next.message);
      else showError(next.message);
    },
    [showError, success]
  );

  const loadCardsData = useCallback(async (reads: DashboardDataLoadOptions = {}) => {
    const [userDecks, userCards, userSources, userFolders, userTopics] =
      await Promise.all([
        getDecks(user.uid, reads),
        loadUserCards(user.uid, reads),
        getActiveSources(user.uid, reads),
        getActiveStudyFolders(user.uid, reads).catch((error) => {
          console.error("Failed to load folders for Cards filters.", error);
          showError(
            "Folder filters are temporarily unavailable. Your cards are still shown."
          );
          return [] as StudyFolder[];
        }),
        getActiveTopics(user.uid, reads),
      ]);

    return {
      decks: userDecks,
      cards: sortByCreatedAtNewest(userCards, (card) => card.createdAt),
      sources: userSources,
      folders: userFolders,
      topics: userTopics,
    };
  }, [showError, user.uid]);

  const applyCardsData = useCallback(
    (data: Awaited<ReturnType<typeof loadCardsData>>) => {
      setDecks(data.decks);
      setCards(data.cards);
      setSources(data.sources);
      setFolders(data.folders);
      setTopics(data.topics);
      setHasSuccessfulLoad(true);
      setLoadFailed(false);
    },
    []
  );

  const handleCardsLoadError = useCallback(
    (error: unknown) => {
      console.error("Failed to load the Cards workspace.", error);
      setLoadFailed(true);
      showError(
        isFirebasePermissionDenied(error)
          ? "Cards are temporarily unavailable while your workspace permissions sync."
          : "Failed to load cards. Try again in a moment."
      );
    },
    [showError]
  );

  const handleCardsLoadStart = useCallback(() => {
    setLoadFailed(false);
    clearFeedback();
  }, [clearFeedback]);

  const { loading, reload } = useDashboardData({
    requestKey: user.uid,
    load: loadCardsData,
    apply: applyCardsData,
    onError: handleCardsLoadError,
    onLoadStart: handleCardsLoadStart,
  });

  const handleCardsCreated = useCallback(
    (createdCards: Card[], meta: { selectCreated: boolean }) => {
      if (createdCards.length === 0) return;

      setCards((current) => {
        const existingIds = new Set(current.map((card) => card.id));
        const freshCards = createdCards.filter(
          (card) => !existingIds.has(card.id)
        );
        return [...freshCards, ...current];
      });

      if (meta.selectCreated) {
        setSelectedCardIds(createdCards.map((card) => card.id));
        setBulkTopicResetKey((current) => current + 1);
      }
    },
    []
  );

  const workflowFeedback = useMemo(
    () => ({ clear: clearFeedback, showError, success }),
    [clearFeedback, showError, success]
  );

  if (loadFailed && !hasSuccessfulLoad) {
    return (
      <AppPage
        title={FLASHCARDS_TITLE}
        backHref="/dashboard"
        backLabel="Today"
        width="2xl"
        contentClassName="space-y-4 sm:space-y-6"
      >
        <SegmentedControl items={FLASHCARD_VIEWS} label="Flashcard views" />
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={clearFeedback}
          />
        ) : null}
        <EmptyState
          emoji="Cards"
          title="Cards are unavailable"
          description="We could not load your Cards workspace, so it has not been treated as empty."
          action={
            <Button type="button" onClick={() => void reload()}>
              Try again
            </Button>
          }
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title={FLASHCARDS_TITLE}
      backHref="/dashboard"
      backLabel="Today"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      <SegmentedControl items={FLASHCARD_VIEWS} label="Flashcard views" />

      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={clearFeedback}
        />
      ) : null}

      <CardsGettingStarted
        deckCount={decks.length}
        cardCount={cards.length}
        topicCount={topics.length}
        loading={loading}
      />

      <CardCreationPanel
        userId={user.uid}
        decks={decks}
        decksLoading={loading}
        existingCards={cards}
        topics={topics}
        onTopicsChange={setTopics}
        onCardsCreated={handleCardsCreated}
        onFeedback={handlePanelFeedback}
      />

      <CardBrowserWorkspace
        userId={user.uid}
        data={{ cards, decks, sources, folders, topics }}
        setCards={setCards}
        setTopics={setTopics}
        selectedCardIds={selectedCardIds}
        setSelectedCardIds={setSelectedCardIds}
        bulkTopicResetKey={bulkTopicResetKey}
        feedback={workflowFeedback}
        loading={loading}
      />
    </AppPage>
  );
}
