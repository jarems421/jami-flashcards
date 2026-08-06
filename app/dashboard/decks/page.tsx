"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { useInlineRowEditing } from "@/hooks/useInlineRowEditing";
import type { Deck } from "@/lib/study/decks";
import { createDeck, deleteDeck, getDecks, renameDeck, updateDeckFolders, updateDeckStyle } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  getDeckColorPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import { loadUserCards } from "@/services/study/cards";
import { getDeckCardCounts, type DeckCounts } from "@/lib/study/deck-counts";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import AppPage from "@/components/layout/AppPage";
import { Button, ButtonLink, ConfirmDialog, EmptyState, FeedbackBanner, Input, PageHero, SegmentedControl, Skeleton, StatTile } from "@/components/ui";
import { FLASHCARD_VIEWS, FLASHCARDS_TITLE } from "@/lib/app/flashcard-views";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { getDeckHref, getDeckStudyHref } from "@/lib/app/routes";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import {
  useDashboardData,
  type DashboardDataLoadOptions,
} from "@/hooks/useDashboardData";

type DeckDraft = {
  name: string;
  colorPreset: DeckColorPresetId;
  iconPreset: DeckIconPresetId;
  folderId: string;
};

const EMPTY_DECK_DRAFT: DeckDraft = {
  name: "",
  colorPreset: "sky",
  iconPreset: "none",
  folderId: "",
};

export default function DecksPage() {
  const { user } = useUser();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [deckCounts, setDeckCounts] = useState<DeckCounts>({});
  const [hasSuccessfulLoad, setHasSuccessfulLoad] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [createFolderId, setCreateFolderId] = useState("");
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const rows = useInlineRowEditing<DeckDraft>();
  const draft = rows.draft ?? EMPTY_DECK_DRAFT;
  const [deckPendingDelete, setDeckPendingDelete] = useState<Deck | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const {
    feedback,
    success,
    showError,
    clear: clearFeedback,
  } = useFeedback();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadDeckData = useCallback(async (reads: DashboardDataLoadOptions = {}) => {
    const [nextDecks, nextFolders, nextCards] = await Promise.all([
      getDecks(user.uid, reads),
      getActiveStudyFolders(user.uid, reads),
      loadUserCards(user.uid, reads),
    ]);
    return {
      decks: nextDecks,
      folders: nextFolders,
      counts: getDeckCardCounts(
        nextDecks.map((deck) => deck.id),
        nextCards,
        Date.now()
      ),
    };
  }, [user.uid]);

  const applyDeckData = useCallback(
    (data: Awaited<ReturnType<typeof loadDeckData>>) => {
      setDecks(data.decks);
      setFolders(data.folders);
      setDeckCounts(data.counts);
      setHasSuccessfulLoad(true);
      setLoadError(null);
    },
    []
  );

  const handleDeckLoadError = useCallback((error: unknown) => {
    console.error("Failed to load decks and their workspace data.", error);
    setLoadError(
      isFirebasePermissionDenied(error)
        ? "Decks are temporarily unavailable while your workspace permissions sync."
        : "Failed to load decks. Try again in a moment."
    );
  }, []);

  const { loading: isLoadingDecks, reload: loadAll } = useDashboardData({
    requestKey: user.uid,
    load: loadDeckData,
    apply: applyDeckData,
    onError: handleDeckLoadError,
  });

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (document.visibilityState !== "hidden" && now - lastForegroundRefreshAtRef.current > 15_000) {
        lastForegroundRefreshAtRef.current = now;
        void loadAll();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearFeedback();
    try {
      // Asked for in so many words, so it goes to the server. Answering this
      // from the cache would look like the button doing nothing.
      await loadAll({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, [clearFeedback, loadAll]);

  const resetDeckEditing = () => {
    rows.cancelEditing();
  };

  const handleCreate = async () => {
    const deckName = name.trim();
    if (!deckName) return;
    setIsCreatingDeck(true);
    clearFeedback();
    try {
      await createDeck(user.uid, deckName, { folderIds: createFolderId ? [createFolderId] : [] });
      setName("");
      setCreateFolderId("");
      await loadAll();
      success(`Created deck ${deckName}`);
    } catch (error) {
      console.error("Failed to create a deck.", error);
      showError("Error creating deck. Please try again.");
    } finally {
      setIsCreatingDeck(false);
    }
  };

  const handleDeckRename = async (deck: Deck) => {
    rows.setSaving(deck.id);
    clearFeedback();
    try {
      await renameDeck(user.uid, deck.id, draft.name.trim());
      await updateDeckStyle(user.uid, deck.id, {
        colorPreset: draft.colorPreset,
        iconPreset: draft.iconPreset,
      });
      await updateDeckFolders(user.uid, deck.id, draft.folderId ? [draft.folderId] : []);
      await loadAll();
      resetDeckEditing();
      success(`Saved changes to ${draft.name.trim()}`);
    } catch (error) {
      console.error("Failed to save deck changes.", error);
      showError("Failed to rename deck.");
    } finally {
      rows.setSaving(null);
    }
  };

  const handleDeckDelete = async (deck: Deck) => {
    rows.setDeleting(deck.id);
    clearFeedback();
    try {
      await deleteDeck(user.uid, deck.id);
      await loadAll();
      setDeckPendingDelete(null);
      success(`Deleted deck ${deck.name}`);
    } catch (error) {
      console.error("Failed to delete a deck.", error);
      showError("Failed to delete deck.");
    } finally {
      rows.setDeleting(null);
    }
  };

  if (loadError && !hasSuccessfulLoad) {
    return (
      <Refreshable onRefresh={handleRefresh}>
        <AppPage
          title={FLASHCARDS_TITLE}
          backHref="/dashboard"
          backLabel="Today"
          width="2xl"
          action={
            <RefreshIconButton
              refreshing={refreshing}
              onClick={() => void handleRefresh()}
            />
          }
          contentClassName="space-y-4 sm:space-y-6"
        >
          <SegmentedControl items={FLASHCARD_VIEWS} label="Flashcard views" />
          <FeedbackBanner
            type="error"
            message={loadError}
            autoDismissMs={0}
            onDismiss={() => setLoadError(null)}
          />
          <EmptyState
            emoji="Deck"
            title="Decks are unavailable"
            description="We could not load your decks, so the workspace has not been treated as empty."
            action={
              <Button
                type="button"
                disabled={isLoadingDecks}
                aria-busy={isLoadingDecks}
                onClick={() => void loadAll()}
              >
                {isLoadingDecks ? "Trying again..." : "Try again"}
              </Button>
            }
          />
        </AppPage>
      </Refreshable>
    );
  }

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title={FLASHCARDS_TITLE}
        backHref="/dashboard"
        backLabel="Today"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-4 sm:space-y-6"
      >
        <SegmentedControl items={FLASHCARD_VIEWS} label="Flashcard views" />
        {loadError ? (
          <FeedbackBanner
            type="error"
            message={loadError}
            autoDismissMs={0}
            onDismiss={() => setLoadError(null)}
          />
        ) : null}
        {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => clearFeedback()} /> : null}
        <ConfirmDialog
          open={deckPendingDelete !== null}
          title={`Delete ${deckPendingDelete?.name ?? "this deck"}?`}
          description="This permanently deletes the deck and every card inside it. This cannot be undone."
          confirmLabel="Delete deck"
          busy={
            deckPendingDelete !== null &&
            rows.isDeleting(deckPendingDelete.id)
          }
          onClose={() => setDeckPendingDelete(null)}
          onConfirm={() => {
            if (deckPendingDelete) void handleDeckDelete(deckPendingDelete);
          }}
        />

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
          <PageHero
            eyebrow="Decks"
            title="New deck"
            action={
              <div className="w-full min-w-0 max-w-[32rem] space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8.5rem,11.5rem)]">
                  <Input
                    ref={nameInputRef}
                    label="Name"
                    placeholder="Deck name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && name.trim()) {
                        event.preventDefault();
                        void handleCreate();
                      }
                    }}
                    containerClassName="min-w-0"
                    className="min-h-[2.9rem] px-4 py-3 text-base leading-6"
                  />
                  <label className="block min-w-0 overflow-visible">
                    <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary">
                      Folder
                    </span>
                    <select
                      value={createFolderId}
                      onChange={(event) => setCreateFolderId(event.target.value)}
                      className="app-field min-h-[2.9rem] w-full min-w-0 appearance-none truncate rounded-[1.6rem] px-3 py-3 text-sm leading-6 outline-none"
                    >
                      <option value="">No folder</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Button
                  disabled={isCreatingDeck || !name.trim()}
                  onClick={() => void handleCreate()}
                  className="min-h-[2.9rem] w-full sm:w-auto sm:min-w-[10rem]"
                >
                  {isCreatingDeck ? "Creating..." : "Create deck"}
                </Button>
              </div>
            }
          />


        
        
          <div className="grid gap-4">
            {/*
              The deck list below shows a skeleton while loading, but this tile
              sat outside it and read a confident "0" until the decks arrived.
            */}
            <StatTile
              label="Decks"
              value={isLoadingDecks ? "..." : decks.length}
              detail="Card sets ready to study."
            />
            <StatTile label="All cards" value="Open" detail="Search and edit cards across every deck." href="/dashboard/cards" />
          </div>
        </div>

        {isLoadingDecks ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : decks.length === 0 ? (
          <EmptyState
            emoji="Deck"
            eyebrow="Start here"
            title="Create your first deck"
            description="Create a deck to hold cards."
            action={<Button type="button" onClick={() => nameInputRef.current?.focus()} variant="warm">Name a deck</Button>}
          />
        ) : (
          <div className="grid animate-slide-up gap-3 sm:gap-4 lg:grid-cols-2">
            {decks.map((deck) => {
              const counts = deckCounts[deck.id] ?? { due: 0, total: 0 };
              const deckColor = getDeckColorPreset(deck.colorPreset);
              const folderName =
                deck.folderIds.length === 1
                  ? folders.find((folder) => folder.id === deck.folderIds[0])?.name
                  : undefined;
              return (
                <div
                  key={deck.id}
                  className="app-panel p-3 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
                  style={{
                    backgroundImage: `linear-gradient(140deg, ${deckColor.base}22, ${deckColor.light}10, transparent)`,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 basis-full">
                      {rows.isEditing(deck.id) ? (
                        <div className="space-y-3">
                          <div className="app-subtle-panel space-y-3 rounded-[1.4rem] p-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Deck cover</div>
                            <div className="app-chip flex flex-wrap items-center gap-3 rounded-[1rem] p-3 sm:flex-nowrap">
                              <DeckCoverIcon
                                colorPreset={draft.colorPreset}
                                iconPreset={draft.iconPreset}
                                className="h-12 w-12"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-text-primary">
                                  {draft.name.trim() || "Deck preview"}
                                </div>
                                <div className="text-xs text-text-muted">
                                  Updates as you style it
                                </div>
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                label="Deck name"
                                value={draft.name}
                                onChange={(event) => rows.updateDraft({ name: event.target.value })}
                                placeholder="Deck name"
                              />
                              <label className="block">
                                <span className="mb-2 block text-sm font-medium text-text-secondary">Folder</span>
                                <select
                                  value={draft.folderId}
                                  onChange={(event) => rows.updateDraft({ folderId: event.target.value })}
                                  className="app-field min-h-[2.75rem] w-full rounded-2xl px-3 text-sm outline-none"
                                >
                                  <option value="">No folder</option>
                                  {folders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                      {folder.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <ObjectStylePicker
                              color={draft.colorPreset}
                              icon={draft.iconPreset}
                              onColorChange={(colorPreset) => rows.updateDraft({ colorPreset })}
                              onIconChange={(iconPreset) => rows.updateDraft({ iconPreset })}
                              colorLabel="Deck colour"
                              iconLabel="Deck icon"
                              compact
                            />
                          </div>
                          <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                            <Button
                              type="button"
                              variant="danger"
                              disabled={
                                rows.isSaving(deck.id) ||
                                rows.isDeleting(deck.id)
                              }
                              onClick={() => setDeckPendingDelete(deck)}
                              className="w-full sm:w-auto"
                            >
                              {rows.isDeleting(deck.id) ? "Deleting..." : "Delete deck"}
                            </Button>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                type="button"
                                disabled={rows.isSaving(deck.id)}
                                onClick={resetDeckEditing}
                                variant="ghost"
                                className="w-full sm:w-auto"
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                disabled={rows.isSaving(deck.id) || !draft.name.trim()}
                                onClick={() => void handleDeckRename(deck)}
                                className="w-full sm:w-auto"
                              >
                                {rows.isSaving(deck.id) ? "Saving..." : "Save deck"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <Link href={getDeckHref(deck.id)} aria-label={`Open ${deck.name}`} className="group flex items-center gap-3 transition duration-fast hover:opacity-90">
                          <DeckCoverIcon colorPreset={deck.colorPreset} iconPreset={deck.iconPreset} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium leading-5" title={deck.name}>{deck.name}</div>
                            <div className="mt-1 text-sm text-text-muted">
                              {counts.total} cards, {counts.due} due
                              {folderName ? `, ${folderName}` : ""}
                            </div>
                          </div>
                        </Link>
                      )}
                    </div>

                    {rows.isEditing(deck.id) ? null : (
                      <div className="flex w-full flex-wrap gap-2">
                        <ButtonLink
                          href={getDeckStudyHref(deck.id)}
                          size="sm"
                          className="flex-1 sm:flex-none"
                        >
                          Study
                        </ButtonLink>
                        <Link
                          href={`${getDeckHref(deck.id)}#add-card`}
                          className="inline-flex min-h-[2.5rem] flex-1 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 text-sm font-medium text-[var(--button-secondary-text)] sm:flex-none"
                        >
                          Add card
                        </Link>
                        <Button type="button" disabled={rows.isDeleting(deck.id)} onClick={() => { rows.startEditing(deck.id, { name: deck.name, colorPreset: deck.colorPreset, iconPreset: deck.iconPreset, folderId: deck.folderIds[0] ?? "" }); clearFeedback(); }} variant="secondary" className="flex-1 sm:flex-none">
                          Edit
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AppPage>
    </Refreshable>
  );
}
