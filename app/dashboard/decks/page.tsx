"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { createDeck, deleteDeck, getDecks, renameDeck, type Deck } from "@/services/study/decks";
import { db } from "@/services/firebase/client";
import AppPage from "@/components/layout/AppPage";
import { Button, EmptyState, FeedbackBanner, Input, Skeleton } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { getDeckHref } from "@/lib/app/routes";

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
  const [savingDeckId, setSavingDeckId] = useState<string | null>(null);
  const [deletingDeckId, setDeletingDeckId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
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
      await loadAll();
      setEditingDeckId(null);
      setEditingDeckName("");
      setFeedback({ type: "success", message: `Renamed deck to ${editingDeckName.trim()}.` });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to rename deck." });
    } finally {
      setSavingDeckId(null);
    }
  };

  const handleDeckDelete = async (deck: Deck) => {
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
        contentClassName="space-y-6"
      >
        {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_320px]">
          <div className="app-panel-warm p-6">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Deck management</div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Organize your cards.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">Decks are for editing. Study lives in the Study tab.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Input
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
          </div>

          <div className="grid gap-4">
            <div className="app-panel p-5">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Decks</div>
              <div className="mt-3 text-3xl font-semibold">{decks.length}</div>
            </div>
            <div className="app-panel p-5">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Cards</div>
              <p className="mt-3 text-sm leading-6 text-text-secondary">Search and edit across decks.</p>
              <Link href="/dashboard/cards" className="mt-4 inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]">
                Open cards
              </Link>
            </div>
          </div>
        </div>

        {isLoadingDecks ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : decks.length === 0 ? (
          <EmptyState emoji="📦" title="No decks yet" description="Create your first deck above to get started." />
        ) : (
          <div className="grid animate-slide-up gap-4 lg:grid-cols-2">
            {decks.map((deck) => {
              const counts = deckCounts[deck.id] ?? { due: 0, total: 0 };
              return (
                <div key={deck.id} className="app-panel p-4 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingDeckId === deck.id ? (
                        <div className="space-y-2">
                          <Input value={editingDeckName} onChange={(event) => setEditingDeckName(event.target.value)} placeholder="Deck name" />
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" disabled={savingDeckId === deck.id || !editingDeckName.trim()} onClick={() => void handleDeckRename(deck)}>{savingDeckId === deck.id ? "Saving..." : "Save"}</Button>
                            <Button type="button" disabled={savingDeckId === deck.id} onClick={resetDeckEditing} variant="secondary">Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <Link href={getDeckHref(deck.id)} className="block transition duration-fast hover:opacity-80">
                          <div className="font-semibold">{deck.name}</div>
                          <div className="text-sm text-text-muted">{counts.total} cards · {counts.due} currently due</div>
                        </Link>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button type="button" disabled={deletingDeckId === deck.id} onClick={() => { setEditingDeckId(deck.id); setEditingDeckName(deck.name); setFeedback(null); }} variant="secondary">
                        Rename
                      </Button>
                      <Button type="button" disabled={deletingDeckId === deck.id} onClick={() => void handleDeckDelete(deck)} variant="danger">
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
