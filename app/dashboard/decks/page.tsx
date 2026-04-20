"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { createDeck, deleteDeck, getDecks, renameDeck, updateDeckStyle, type Deck } from "@/services/study/decks";
import {
  DECK_COLOR_PRESETS,
  DECK_ICON_PRESETS,
  getDeckColorPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import { db } from "@/services/firebase/client";
import AppPage from "@/components/layout/AppPage";
import { Button, EmptyState, FeedbackBanner, Input, PageHero, Skeleton, StatTile } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { getDeckHref } from "@/lib/app/routes";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";

type DeckCounts = Record<string, { due: number; total: number }>;
type Feedback = { type: "success" | "error"; message: string };

export default function DecksPage() {
  const { user } = useUser();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckCounts, setDeckCounts] = useState<DeckCounts>({});
  const [name, setName] = useState("");
  const [isLoadingDecks, setIsLoadingDecks] = useState(true);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [editingDeckColor, setEditingDeckColor] = useState<DeckColorPresetId>("aurora");
  const [editingDeckIcon, setEditingDeckIcon] = useState<DeckIconPresetId>("book");
  const [savingDeckId, setSavingDeckId] = useState<string | null>(null);
  const [deletingDeckId, setDeletingDeckId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadAll = useCallback(async () => {
    setIsLoadingDecks(true);
    try {
      const [nextDecks, cardsSnapshot] = await Promise.all([
        getDecks(user.uid),
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
      setDeckCounts(nextCounts);
    } catch (error) {
      console.error(error);
      setDecks([]);
      setDeckCounts({});
      setFeedback({ type: "error", message: "Failed to load decks." });
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
    setEditingDeckColor("aurora");
    setEditingDeckIcon("book");
  };

  const handleCreate = async () => {
    const deckName = name.trim();
    if (!deckName) return;
    setIsCreatingDeck(true);
    setFeedback(null);
    try {
      await createDeck(user.uid, deckName);
      setName("");
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
    setSavingDeckId(deck.id);
    setFeedback(null);
    try {
      await renameDeck(user.uid, deck.id, editingDeckName.trim());
      await updateDeckStyle(user.uid, deck.id, {
        colorPreset: editingDeckColor,
        iconPreset: editingDeckIcon,
      });
      await loadAll();
      resetDeckEditing();
      setFeedback({ type: "success", message: `Renamed deck to ${editingDeckName.trim()}.` });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to rename deck." });
    } finally {
      setSavingDeckId(null);
    }
  };

  const handleDeckDelete = async (deck: Deck) => {
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
        backLabel="Dashboard"
        width="2xl"
        action={<RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />}
        contentClassName="space-y-4 sm:space-y-6"
      >
        {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
          <PageHero
            eyebrow="Deck management"
            title="Organize your cards."
            description="Decks are for editing and structure. Study lives in the Study tab."
            action={
              <div className="flex w-full flex-col gap-3 sm:flex-row">
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
                  containerClassName="w-full"
                />
                <Button disabled={isCreatingDeck || !name.trim()} onClick={() => void handleCreate()} className="sm:min-w-[9rem]">
                  {isCreatingDeck ? "Creating..." : "Create deck"}
                </Button>
              </div>
            }
          />

          <div className="grid gap-4">
            <StatTile label="Decks" value={decks.length} detail="Organised subject groups." />
            <StatTile label="Cards" value="Manage" detail="Search and edit across decks." href="/dashboard/cards" />
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
            description="Decks keep your cards organised by subject. Add one topic now, then start filling it with flashcards."
            action={<Button type="button" onClick={() => nameInputRef.current?.focus()} variant="warm">Name a deck</Button>}
          />
        ) : (
          <div className="grid animate-slide-up gap-3 sm:gap-4 lg:grid-cols-2">
            {decks.map((deck) => {
              const counts = deckCounts[deck.id] ?? { due: 0, total: 0 };
              return (
                <div
                  key={deck.id}
                  className="app-panel p-3 sm:p-4 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
                  style={{
                    backgroundImage: getDeckColorPreset(deck.colorPreset).cardTint,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingDeckId === deck.id ? (
                        <div className="space-y-3">
                          <Input value={editingDeckName} onChange={(event) => setEditingDeckName(event.target.value)} placeholder="Deck name" />
                          <div className="space-y-3 rounded-[1.4rem] border border-white/[0.07] bg-white/[0.04] p-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Cover</div>
                            <div className="flex flex-wrap items-center gap-3 rounded-[1rem] border border-white/[0.08] bg-black/10 p-3 sm:flex-nowrap">
                              <DeckCoverIcon
                                colorPreset={editingDeckColor}
                                iconPreset={editingDeckIcon}
                                className="h-12 w-12"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white">
                                  {editingDeckName.trim() || "Deck preview"}
                                </div>
                                <div className="text-xs text-text-muted">
                                  Live cover preview
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {DECK_COLOR_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  aria-label={`Use ${preset.label} deck color`}
                                  onClick={() => setEditingDeckColor(preset.id)}
                                  className={`h-8 w-8 rounded-full border-2 sm:h-9 sm:w-9 ${editingDeckColor === preset.id ? "border-white" : "border-white/20"}`}
                                  style={{ backgroundImage: preset.iconGradient }}
                                />
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {DECK_ICON_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => setEditingDeckIcon(preset.id)}
                                  className={`flex min-h-[3rem] w-full items-center gap-2 rounded-[1rem] border px-2.5 py-2 text-left text-white transition sm:min-h-[3.25rem] sm:gap-2.5 sm:px-3 ${editingDeckIcon === preset.id ? "border-accent bg-accent/20 shadow-[0_0_0_3px_rgba(255,214,246,0.08)]" : "border-white/[0.08] bg-white/[0.04] hover:border-border-strong"}`}
                                >
                                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 shrink-0">
                                    <path d={preset.path} />
                                  </svg>
                                  <span className="min-w-0 text-wrap break-words text-[0.72rem] font-semibold leading-4 [overflow-wrap:anywhere] sm:text-[0.78rem]">
                                    {preset.label}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              disabled={savingDeckId === deck.id || !editingDeckName.trim()}
                              onClick={() => void handleDeckRename(deck)}
                              className="w-full sm:w-auto"
                            >
                              {savingDeckId === deck.id ? "Saving..." : "Save"}
                            </Button>
                            <Button
                              type="button"
                              disabled={savingDeckId === deck.id}
                              onClick={resetDeckEditing}
                              variant="secondary"
                              className="w-full sm:w-auto"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Link href={getDeckHref(deck.id)} className="flex items-center gap-3 transition duration-fast hover:opacity-80">
                          <DeckCoverIcon colorPreset={deck.colorPreset} iconPreset={deck.iconPreset} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{deck.name}</div>
                            <div className="text-sm text-text-muted">{counts.total} cards | {counts.due} currently due</div>
                          </div>
                        </Link>
                      )}
                    </div>

                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                      <Button type="button" disabled={deletingDeckId === deck.id} onClick={() => { setEditingDeckId(deck.id); setEditingDeckName(deck.name); setEditingDeckColor(deck.colorPreset); setEditingDeckIcon(deck.iconPreset); setFeedback(null); }} variant="secondary" className="flex-1 sm:flex-none">
                        Customise
                      </Button>
                      <Button type="button" disabled={deletingDeckId === deck.id} onClick={() => void handleDeckDelete(deck)} variant="danger" className="flex-1 sm:flex-none">
                        {deletingDeckId === deck.id ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
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
