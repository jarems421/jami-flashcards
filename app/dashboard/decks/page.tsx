"use client";

import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { createDeck, deleteDeck, getDecks, renameDeck, updateDeckFolders, updateDeckStyle, type Deck } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  getDeckColorPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import { db } from "@/services/firebase/client";
import AppPage from "@/components/layout/AppPage";
import { Button, ConfirmDialog, EmptyState, FeedbackBanner, Input, PageHero, Skeleton, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { getDeckHref, getDeckStudyHref } from "@/lib/app/routes";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";

type DeckCounts = Record<string, { due: number; total: number }>;
type Feedback = { type: "success" | "error"; message: string };

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

export default function DecksPage() {
  const { user, isDemoUser } = useUser();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [deckCounts, setDeckCounts] = useState<DeckCounts>({});
  const [name, setName] = useState("");
  const [createFolderId, setCreateFolderId] = useState("");
  const [isLoadingDecks, setIsLoadingDecks] = useState(true);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [editingDeckColor, setEditingDeckColor] = useState<DeckColorPresetId>("sky");
  const [editingDeckIcon, setEditingDeckIcon] = useState<DeckIconPresetId>("none");
  const [editingDeckFolderId, setEditingDeckFolderId] = useState("");
  const [savingDeckId, setSavingDeckId] = useState<string | null>(null);
  const [deletingDeckId, setDeletingDeckId] = useState<string | null>(null);
  const [deckPendingDelete, setDeckPendingDelete] = useState<Deck | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadAll = useCallback(async () => {
    setIsLoadingDecks(true);
    try {
      const [nextDecks, nextFolders, cardsSnapshot] = await Promise.all([
        getDecks(user.uid),
        getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
        getDocs(query(collection(db, "cards"), where("userId", "==", user.uid))),
      ]);
      const nextCounts: DeckCounts = {};
      const now = Date.now();

      for (const deck of nextDecks) {
        nextCounts[deck.id] = { due: 0, total: 0 };
      }

      for (const cardDoc of cardsSnapshot.docs) {
        const data = cardDoc.data() as { deckId?: unknown; dueDate?: unknown };
        if (typeof data.deckId !== "string" || !nextCounts[data.deckId]) {
          continue;
        }

        nextCounts[data.deckId].total += 1;
        if (typeof data.dueDate !== "number" || data.dueDate <= now) {
          nextCounts[data.deckId].due += 1;
        }
      }

      setDecks(nextDecks);
      setFolders(nextFolders);
      setDeckCounts(nextCounts);
    } catch (error) {
      console.error(error);
      setDecks([]);
      setDeckCounts({});
      if (!isPermissionDenied(error)) {
        setFeedback({ type: "error", message: "Failed to load decks." });
      }
    } finally {
      setIsLoadingDecks(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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
    setFeedback(null);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [loadAll]);

  const resetDeckEditing = () => {
    setEditingDeckId(null);
    setEditingDeckName("");
    setEditingDeckColor("sky");
    setEditingDeckIcon("none");
    setEditingDeckFolderId("");
  };

  const handleCreate = async () => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Deck creation is disabled in the shared demo account." });
      return;
    }

    const deckName = name.trim();
    if (!deckName) return;
    setIsCreatingDeck(true);
    setFeedback(null);
    try {
      await createDeck(user.uid, deckName, { folderIds: createFolderId ? [createFolderId] : [] });
      setName("");
      setCreateFolderId("");
      await loadAll();
      setFeedback({ type: "success", message: `Created deck ${deckName}` });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Error creating deck. Please try again." });
    } finally {
      setIsCreatingDeck(false);
    }
  };

  const handleDeckRename = async (deck: Deck) => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Deck editing is disabled in the shared demo account." });
      return;
    }

    setSavingDeckId(deck.id);
    setFeedback(null);
    try {
      await renameDeck(user.uid, deck.id, editingDeckName.trim());
      await updateDeckStyle(user.uid, deck.id, {
        colorPreset: editingDeckColor,
        iconPreset: editingDeckIcon,
      });
      await updateDeckFolders(user.uid, deck.id, editingDeckFolderId ? [editingDeckFolderId] : []);
      await loadAll();
      resetDeckEditing();
      setFeedback({ type: "success", message: `Saved changes to ${editingDeckName.trim()}` });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to rename deck." });
    } finally {
      setSavingDeckId(null);
    }
  };

  const handleDeckDelete = async (deck: Deck) => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Deck deletion is disabled in the shared demo account." });
      return;
    }

    setDeletingDeckId(deck.id);
    setFeedback(null);
    try {
      await deleteDeck(user.uid, deck.id);
      await loadAll();
      setDeckPendingDelete(null);
      setFeedback({ type: "success", message: `Deleted deck ${deck.name}` });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to delete deck." });
    } finally {
      setDeletingDeckId(null);
    }
  };

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Decks"
        backHref="/dashboard"
        backLabel="Today"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-4 sm:space-y-6"
      >
        {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
        <ConfirmDialog
          open={deckPendingDelete !== null}
          title={`Delete ${deckPendingDelete?.name ?? "this deck"}?`}
          description="This permanently deletes the deck and every card inside it. This cannot be undone."
          confirmLabel="Delete deck"
          busy={
            deckPendingDelete !== null &&
            deletingDeckId === deckPendingDelete.id
          }
          onClose={() => setDeckPendingDelete(null)}
          onConfirm={() => {
            if (deckPendingDelete) void handleDeckDelete(deckPendingDelete);
          }}
        />

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
          <PageHero
            eyebrow="Library"
            title="Decks"
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
                  disabled={isDemoUser || isCreatingDeck || !name.trim()}
                  onClick={() => void handleCreate()}
                  className="min-h-[2.9rem] w-full sm:w-auto sm:min-w-[10rem]"
                >
                  {isCreatingDeck ? "Creating..." : "Create deck"}
                </Button>
              </div>
            }
          />

          <div className="grid gap-4">
            <StatTile label="Decks" value={decks.length} detail="Card sets ready to study." />
            <StatTile label="Card library" value="Open" detail="Search and edit cards across every deck." href="/dashboard/cards" />
          </div>
        </div>

        {isDemoUser ? (
          <div className="app-subtle-panel rounded-[1.6rem] p-4 text-sm">
            <div className="font-semibold text-text-primary">Deck editing is locked in the shared demo</div>
          </div>
        ) : null}

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
                      {editingDeckId === deck.id ? (
                        <div className="space-y-3">
                          <div className="app-subtle-panel space-y-3 rounded-[1.4rem] p-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Deck cover</div>
                            <div className="app-chip flex flex-wrap items-center gap-3 rounded-[1rem] p-3 sm:flex-nowrap">
                              <DeckCoverIcon
                                colorPreset={editingDeckColor}
                                iconPreset={editingDeckIcon}
                                className="h-12 w-12"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-text-primary">
                                  {editingDeckName.trim() || "Deck preview"}
                                </div>
                                <div className="text-xs text-text-muted">
                                  Updates as you style it
                                </div>
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                label="Deck name"
                                value={editingDeckName}
                                onChange={(event) => setEditingDeckName(event.target.value)}
                                placeholder="Deck name"
                              />
                              <label className="block">
                                <span className="mb-2 block text-sm font-medium text-text-secondary">Folder</span>
                                <select
                                  value={editingDeckFolderId}
                                  onChange={(event) => setEditingDeckFolderId(event.target.value)}
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
                              color={editingDeckColor}
                              icon={editingDeckIcon}
                              onColorChange={setEditingDeckColor}
                              onIconChange={setEditingDeckIcon}
                              colorLabel="Deck colour"
                              iconLabel="Deck icon"
                              compact
                            />
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              disabled={isDemoUser || savingDeckId === deck.id || !editingDeckName.trim()}
                              onClick={() => void handleDeckRename(deck)}
                              className="w-full sm:w-auto"
                            >
                              {savingDeckId === deck.id ? "Saving..." : "Save deck"}
                            </Button>
                            <Button
                              type="button"
                              disabled={isDemoUser || savingDeckId === deck.id}
                              onClick={resetDeckEditing}
                              variant="secondary"
                              className="w-full sm:w-auto"
                            >
                              Cancel
                            </Button>
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

                    {editingDeckId === deck.id ? null : (
                      <div className="flex w-full flex-wrap gap-2">
                        <Link
                          href={getDeckStudyHref(deck.id)}
                          className="inline-flex min-h-[2.5rem] flex-1 items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-3 text-sm font-medium text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] sm:flex-none"
                        >
                          Study
                        </Link>
                        <Link
                          href={`${getDeckHref(deck.id)}#add-card`}
                          className="inline-flex min-h-[2.5rem] flex-1 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 text-sm font-medium text-[var(--button-secondary-text)] sm:flex-none"
                        >
                          Add card
                        </Link>
                        <Button type="button" disabled={isDemoUser || deletingDeckId === deck.id} onClick={() => { setEditingDeckId(deck.id); setEditingDeckName(deck.name); setEditingDeckColor(deck.colorPreset); setEditingDeckIcon(deck.iconPreset); setEditingDeckFolderId(deck.folderIds[0] ?? ""); setFeedback(null); }} variant="secondary" className="flex-1 sm:flex-none">
                          Edit
                        </Button>
                        <Button type="button" disabled={isDemoUser || deletingDeckId === deck.id} onClick={() => setDeckPendingDelete(deck)} variant="danger" className="flex-1 sm:flex-none">
                          {deletingDeckId === deck.id ? "Deleting..." : "Delete"}
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
