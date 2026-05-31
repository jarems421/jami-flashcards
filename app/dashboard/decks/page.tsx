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
import { Button, EmptyState, FeedbackBanner, Input, PageHero, Skeleton, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { getDeckHref } from "@/lib/app/routes";
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
      setFeedback({ type: "success", message: `Created deck ${deckName}.` });
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
      setFeedback({ type: "success", message: `Saved changes to ${editingDeckName.trim()}.` });
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

    const shouldDelete = window.confirm(
      `Delete ${deck.name}? This will also delete the cards in this deck.`
    );
    if (!shouldDelete) return;

    setDeletingDeckId(deck.id);
    setFeedback(null);
    try {
      await deleteDeck(user.uid, deck.id);
      await loadAll();
      setFeedback({ type: "success", message: `Deleted deck ${deck.name}.` });
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

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
          <PageHero
            eyebrow="Library"
            title="Decks are groups of flashcards."
            description="Create a deck first. Then open it to add cards, edit the set, or jump into a focused study session."
            action={
            <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(18rem,1fr)_minmax(14rem,0.75fr)_auto]">
                <Input
                  ref={nameInputRef}
                  placeholder="New deck name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && name.trim()) {
                      event.preventDefault();
                      void handleCreate();
                    }
                  }}
                  containerClassName="min-w-0"
                  className="min-h-[3.25rem] text-base leading-6"
                />
                <label className="block min-w-0">
                  <span className="sr-only">Add to folder</span>
                <select
                  value={createFolderId}
                  onChange={(event) => setCreateFolderId(event.target.value)}
                  className="app-field min-h-[3.25rem] w-full appearance-none rounded-[1.6rem] px-4 py-3 text-sm leading-6 outline-none"
                >
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button disabled={isDemoUser || isCreatingDeck || !name.trim()} onClick={() => void handleCreate()} className="min-h-[3.25rem] sm:col-span-2 lg:col-span-1 lg:min-w-[9rem]">
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

        <div className="app-subtle-panel rounded-[1.35rem] p-4 text-sm leading-6">
          <span className="font-semibold text-text-primary">Decks vs Cards:</span> Decks are the groups, like
          Biology key terms, Cold War dates, or Spanish verbs. Cards are the individual prompts inside those groups.
        </div>

        {isDemoUser ? (
          <div className="app-subtle-panel rounded-[1.6rem] p-4 text-sm">
            <div className="font-semibold text-text-primary">Deck editing is locked in the shared demo</div>
            <p className="mt-1 leading-6">
              You can browse the seeded decks here, but creating, renaming, recoloring, and deleting stay locked to keep the shared workspace stable.
            </p>
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
            description="Decks help you group cards by subject, module, or exam. Add one now, then open it to add your first flashcards."
            action={<Button type="button" onClick={() => nameInputRef.current?.focus()} variant="warm">Name a deck</Button>}
          />
        ) : (
          <div className="grid animate-slide-up gap-3 sm:gap-4 lg:grid-cols-2">
            {decks.map((deck) => {
              const counts = deckCounts[deck.id] ?? { due: 0, total: 0 };
              const deckColor = getDeckColorPreset(deck.colorPreset);
              return (
                <div
                  key={deck.id}
                  className="app-panel p-3 sm:p-4 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
                  style={{
                    backgroundImage: `linear-gradient(140deg, ${deckColor.base}22, ${deckColor.light}10, transparent)`,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingDeckId === deck.id ? (
                        <div className="space-y-3">
                          <Input value={editingDeckName} onChange={(event) => setEditingDeckName(event.target.value)} placeholder="Deck name" />
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
                            <ObjectStylePicker
                              color={editingDeckColor}
                              icon={editingDeckIcon}
                              onColorChange={setEditingDeckColor}
                              onIconChange={setEditingDeckIcon}
                              colorLabel="Deck colour"
                              iconLabel="Deck icon"
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
                            <div className="line-clamp-2 font-medium leading-5 [overflow-wrap:anywhere]">{deck.name}</div>
                            <div className="text-sm text-text-muted">{counts.total} cards | {counts.due} currently due</div>
                            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                              <span>Open deck</span>
                              <svg
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5"
                                aria-hidden="true"
                              >
                                <path d="M3.5 8h9" />
                                <path d="m8.5 3 4.5 5-4.5 5" />
                              </svg>
                            </div>
                          </div>
                        </Link>
                      )}
                    </div>

                    {editingDeckId === deck.id ? null : (
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                        <Button type="button" disabled={isDemoUser || deletingDeckId === deck.id} onClick={() => { setEditingDeckId(deck.id); setEditingDeckName(deck.name); setEditingDeckColor(deck.colorPreset); setEditingDeckIcon(deck.iconPreset); setEditingDeckFolderId(deck.folderIds[0] ?? ""); setFeedback(null); }} variant="secondary" className="flex-1 sm:flex-none">
                          Edit deck
                        </Button>
                        <Button type="button" disabled={isDemoUser || deletingDeckId === deck.id} onClick={() => void handleDeckDelete(deck)} variant="danger" className="flex-1 sm:flex-none">
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
