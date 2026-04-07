"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import {
  createDeck,
  deleteDeck,
  getDecks,
  reattemptDeck,
  renameDeck,
  type Deck,
} from "@/services/study/decks";
import { getTagSuggestions, normalizeCardTags } from "@/lib/study/cards";
import { getDeckHref, getDeckStudyHref } from "@/lib/app/routes";
import { db } from "@/services/firebase/client";
import { FirebaseError } from "firebase/app";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, EmptyState, FeedbackBanner, Input, ProgressBar, Skeleton } from "@/components/ui";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { removeUserTag, renameUserTag } from "@/services/study/tags";

type DeckDueCounts = Record<string, number>;
type DeckTotalCounts = Record<string, number>;
type TagCounts = Record<string, number>;
type Feedback = { type: "success" | "error"; message: string };

export default function DecksPage() {
  const router = useRouter();
  const { user } = useUser();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [deckDueCounts, setDeckDueCounts] = useState<DeckDueCounts>({});
  const [deckTotalCounts, setDeckTotalCounts] = useState<DeckTotalCounts>({});
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagDueCounts, setTagDueCounts] = useState<TagCounts>({});
  const [tagTotalCounts, setTagTotalCounts] = useState<TagCounts>({});
  const [name, setName] = useState("");
  const [isLoadingDecks, setIsLoadingDecks] = useState(true);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [savingDeckId, setSavingDeckId] = useState<string | null>(null);
  const [deletingDeckId, setDeletingDeckId] = useState<string | null>(null);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renamingTagValue, setRenamingTagValue] = useState("");
  const [savingTag, setSavingTag] = useState<string | null>(null);
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  const [reattemptingDeckId, setReattemptingDeckId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lastForegroundRefreshAtRef = useRef(0);

  const loadDecks = useCallback(async (uid: string) => {
    setIsLoadingDecks(true);
    try {
      const data = await getDecks(uid);
      setDecks(data);
    } catch (e) {
      console.error(e);
      const code = e instanceof FirebaseError ? e.code : undefined;
      setFeedback({
        type: "error",
        message: code ? `Failed to load decks (${code}).` : "Failed to load decks.",
      });
    } finally {
      setIsLoadingDecks(false);
    }
  }, []);

  const loadDueCount = useCallback(async (uid: string) => {
    try {
      const cardsQuery = query(
        collection(db, "cards"),
        where("userId", "==", uid)
      );
      const snapshot = await getDocs(cardsQuery);
      const now = Date.now();
      const nextDeckDueCounts: DeckDueCounts = {};
      const nextDeckTotalCounts: DeckTotalCounts = {};
      const nextTagDueCounts: TagCounts = {};
      const nextTagTotalCounts: TagCounts = {};
      const nextAvailableTags = new Set<string>();
      let count = 0;
      for (const cardDoc of snapshot.docs) {
        const data = cardDoc.data();
        const dueDate = data.dueDate;
        const tags = normalizeCardTags(data.tags);
        const deckId =
          typeof data.deckId === "string" && data.deckId.trim() ? data.deckId : null;
        const isDue = typeof dueDate !== "number" || dueDate <= now;
        if (deckId) {
          nextDeckTotalCounts[deckId] = (nextDeckTotalCounts[deckId] ?? 0) + 1;
        }
        for (const tag of tags) {
          nextAvailableTags.add(tag);
          nextTagTotalCounts[tag] = (nextTagTotalCounts[tag] ?? 0) + 1;
        }
        if (isDue) {
          count++;
          if (deckId) {
            nextDeckDueCounts[deckId] = (nextDeckDueCounts[deckId] ?? 0) + 1;
          }
          for (const tag of tags) {
            nextTagDueCounts[tag] = (nextTagDueCounts[tag] ?? 0) + 1;
          }
        }
      }
      setDueCount(count);
      setDeckDueCounts(nextDeckDueCounts);
      setDeckTotalCounts(nextDeckTotalCounts);
      setAvailableTags(Array.from(nextAvailableTags).sort((a, b) => a.localeCompare(b)));
      setTagDueCounts(nextTagDueCounts);
      setTagTotalCounts(nextTagTotalCounts);
      setSelectedTags((prev) => prev.filter((tag) => nextAvailableTags.has(tag)));
    } catch (e) {
      console.error(e);
      setDueCount(0);
      setDeckDueCounts({});
      setDeckTotalCounts({});
      setAvailableTags([]);
      setTagDueCounts({});
      setTagTotalCounts({});
      setSelectedTags([]);
    }
  }, []);

  const loadAll = useCallback(
    async (uid: string) => {
      await Promise.all([loadDecks(uid), loadDueCount(uid)]);
    },
    [loadDecks, loadDueCount]
  );

  useEffect(() => {
    void loadAll(user.uid);
  }, [user.uid, loadAll]);

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "hidden" &&
        now - lastForegroundRefreshAtRef.current > 15_000
      ) {
        lastForegroundRefreshAtRef.current = now;
        void loadAll(user.uid);
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [user.uid, loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      await loadAll(user.uid);
    } finally {
      setRefreshing(false);
    }
  }, [user.uid, loadAll]);

  const resetDeckEditing = () => {
    setEditingDeckId(null);
    setEditingDeckName("");
    setSavingDeckId(null);
  };

  const toggleTagSelection = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((currentTag) => currentTag !== tag) : [...prev, tag]
    );
  };

  const cancelTagRename = () => {
    setRenamingTag(null);
    setRenamingTagValue("");
    setSavingTag(null);
  };

  const handleStudySelectedTags = () => {
    if (selectedTags.length === 0) {
      return;
    }

    router.push(`/dashboard/study?tags=${encodeURIComponent(selectedTags.join(","))}`);
  };

  const handleSaveTagRename = async () => {
    const sourceTag = renamingTag;
    if (!sourceTag) {
      return;
    }

    const nextTag = normalizeCardTags([renamingTagValue])[0] ?? "";
    if (!nextTag) {
      setFeedback({ type: "error", message: "Enter a replacement tag." });
      return;
    }

    setSavingTag(sourceTag);
    setFeedback(null);

    try {
      const updatedCards = await renameUserTag(user.uid, sourceTag, nextTag);
      await loadAll(user.uid);
      setSelectedTags((prev) => normalizeCardTags(prev.map((tag) => (tag === sourceTag ? nextTag : tag))));
      cancelTagRename();
      setFeedback({
        type: "success",
        message:
          updatedCards > 0
            ? `Updated ${updatedCards} card${updatedCards === 1 ? "" : "s"}. #${sourceTag} is now #${nextTag}.`
            : `#${sourceTag} already matches #${nextTag}.`,
      });
    } catch (e) {
      console.error(e);
      setSavingTag(null);
      setFeedback({ type: "error", message: "Failed to rename that tag." });
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const shouldRemove = window.confirm(
      `Remove #${tag} from every card that uses it?`
    );
    if (!shouldRemove) {
      return;
    }

    setRemovingTag(tag);
    setFeedback(null);

    try {
      const updatedCards = await removeUserTag(user.uid, tag);
      await loadAll(user.uid);
      setSelectedTags((prev) => prev.filter((selectedTag) => selectedTag !== tag));
      if (renamingTag === tag) {
        cancelTagRename();
      }
      setFeedback({
        type: "success",
        message: `Removed #${tag} from ${updatedCards} card${updatedCards === 1 ? "" : "s"}.`,
      });
    } catch (e) {
      console.error(e);
      setFeedback({ type: "error", message: "Failed to remove that tag." });
    } finally {
      setRemovingTag(null);
    }
  };

  const handleDeckRename = async (deck: Deck) => {
    const trimmedDeckName = editingDeckName.trim();
    if (!trimmedDeckName) {
      setFeedback({ type: "error", message: "Enter a valid deck name." });
      return;
    }

    setSavingDeckId(deck.id);
    setFeedback(null);

    try {
      const nextName = await renameDeck(user.uid, deck.id, trimmedDeckName);
      setDecks((prev) =>
        prev.map((d) =>
          d.id === deck.id ? { ...d, name: nextName } : d
        )
      );
      resetDeckEditing();
      setFeedback({ type: "success", message: `Renamed deck to ${nextName}.` });
    } catch (e) {
      console.error(e);
      setSavingDeckId(null);
      setFeedback({ type: "error", message: "Failed to rename deck." });
    }
  };

  const handleDeckDelete = async (deck: Deck) => {
    const shouldDelete = window.confirm(
      `Delete ${deck.name}? This will also remove its cards.`
    );
    if (!shouldDelete) return;

    setDeletingDeckId(deck.id);
    setFeedback(null);

    try {
      await deleteDeck(user.uid, deck.id);
      setDecks((prev) => prev.filter((d) => d.id !== deck.id));
      setDeckDueCounts((prev) => {
        const next = { ...prev };
        delete next[deck.id];
        return next;
      });
      setDeckTotalCounts((prev) => {
        const next = { ...prev };
        delete next[deck.id];
        return next;
      });
      setDueCount((prev) => Math.max(0, prev - (deckDueCounts[deck.id] ?? 0)));
      if (editingDeckId === deck.id) resetDeckEditing();
      setFeedback({ type: "success", message: `Deleted deck ${deck.name}.` });
    } catch (e) {
      console.error(e);
      setFeedback({ type: "error", message: "Failed to delete deck." });
    } finally {
      setDeletingDeckId(null);
    }
  };

  const handleReattempt = async (deck: Deck) => {
    setReattemptingDeckId(deck.id);
    setFeedback(null);
    try {
      await reattemptDeck(user.uid, deck.id);
      await loadAll(user.uid);
      setFeedback({ type: "success", message: `Reset scheduling for ${deck.name}. Ready to study again!` });
    } catch (e) {
      console.error(e);
      setFeedback({ type: "error", message: "Failed to reattempt deck." });
    } finally {
      setReattemptingDeckId(null);
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
        {feedback ? (
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_320px]">
          <Card padding="lg">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Build your library
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Create and organize decks.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
              Keep subjects clean, add tags for cross-deck study, and return to any topic when you need a deeper pass.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder="New deck name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
                containerClassName="w-full"
                className="sm:max-w-md"
              />
              <Button
                disabled={isCreatingDeck || !name.trim()}
                onClick={() => void handleCreate()}
                size="lg"
                className="sm:min-w-[9rem]"
              >
                {isCreatingDeck ? "Creating…" : "Create"}
              </Button>
            </div>
          </Card>

          <Card tone="warm" padding="md">
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
              Queue
            </div>
            <div className="mt-3 text-3xl font-semibold">{dueCount}</div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Cards are waiting across your deck library. Study by deck or narrow by tag when you want a tighter session.
            </p>
          </Card>
        </div>

        <Card padding="lg">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Study by tag</div>
                <p className="text-sm text-text-secondary">
                  Group cards from different decks by topic, then study only those tags.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedTags.length > 0 ? (
                  <Button
                    type="button"
                    onClick={() => setSelectedTags([])}
                    variant="secondary"
                  >
                    Clear
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={selectedTags.length === 0}
                  onClick={handleStudySelectedTags}
                  className="min-w-[12rem]"
                >
                  Study selected tags
                </Button>
              </div>
            </div>

            {availableTags.length === 0 ? (
              <p className="mt-3 text-sm text-text-muted">
                No tagged cards yet. Add tags inside a deck to unlock topic study across decks.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {availableTags.map((tag) => {
                    const selected = selectedTags.includes(tag);
                    const due = tagDueCounts[tag] ?? 0;
                    const total = tagTotalCounts[tag] ?? 0;

                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTagSelection(tag)}
                        className={`rounded-full border px-3 py-2 text-left text-sm transition duration-fast ${
                          selected
                            ? "border-accent bg-accent/20 text-accent"
                            : "border-border bg-white/[0.04] text-white hover:border-border-strong hover:bg-white/[0.07]"
                        }`}
                      >
                        <div className="font-medium">#{tag}</div>
                        <div className="text-xs text-text-muted">
                          {due} due · {total} total
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-[1.85rem] border border-white/[0.07] bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Manage tags</div>
                      <p className="text-sm text-text-secondary">
                        Rename a tag, merge it into another one, or remove it from every card.
                      </p>
                    </div>
                    {renamingTag ? (
                      <Button
                        type="button"
                        onClick={cancelTagRename}
                        variant="secondary"
                      >
                        Cancel rename
                      </Button>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    {availableTags.map((tag) => {
                      const due = tagDueCounts[tag] ?? 0;
                      const total = tagTotalCounts[tag] ?? 0;
                      const isEditing = renamingTag === tag;
                      const renameSuggestions = isEditing
                        ? getTagSuggestions(availableTags, renamingTagValue, [tag])
                        : [];

                      return (
                        <div key={`manage-${tag}`} className="rounded-[1.5rem] border border-white/[0.06] bg-white/[0.05] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-medium">#{tag}</div>
                              <div className="text-xs text-text-muted">{due} due · {total} total</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                onClick={() => {
                                  setRenamingTag(tag);
                                  setRenamingTagValue(tag);
                                  setFeedback(null);
                                }}
                                variant="secondary"
                              >
                                Rename or merge
                              </Button>
                              <Button
                                type="button"
                                disabled={removingTag === tag}
                                onClick={() => void handleRemoveTag(tag)}
                                variant="danger"
                              >
                                {removingTag === tag ? "Removing…" : "Remove from cards"}
                              </Button>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="mt-3 space-y-3 rounded-[1.5rem] border border-white/[0.06] bg-black/10 p-3">
                              <div className="space-y-2">
                                <Input
                                  label="Rename or merge into"
                                  value={renamingTagValue}
                                  onChange={(event) => setRenamingTagValue(event.target.value)}
                                />
                              </div>

                              {renameSuggestions.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {renameSuggestions.map((suggestion) => (
                                    <button
                                      key={`${tag}-${suggestion}`}
                                      type="button"
                                      onClick={() => setRenamingTagValue(suggestion)}
                                      className="rounded-full border border-border bg-white/[0.05] px-3 py-1.5 text-xs text-text-muted transition duration-fast hover:border-border-strong hover:bg-white/[0.08]"
                                    >
                                      Merge into #{suggestion}
                                    </button>
                                  ))}
                                </div>
                              ) : null}

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  disabled={savingTag === tag}
                                  onClick={() => void handleSaveTagRename()}
                                >
                                  {savingTag === tag ? "Saving…" : "Save tag change"}
                                </Button>
                                <Button
                                  type="button"
                                  disabled={savingTag === tag}
                                  onClick={cancelTagRename}
                                  variant="secondary"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
        </Card>

          {/* ── Deck list ── */}
          {isLoadingDecks ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ) : decks.length === 0 ? (
            <EmptyState
              emoji="📦"
              title="No decks yet"
              description="Create your first deck above to get started."
            />
          ) : (
            <div className="grid animate-slide-up gap-4 xl:grid-cols-2">
              {decks.map((deck) => {
                const due = deckDueCounts[deck.id] ?? 0;
                const total = deckTotalCounts[deck.id] ?? 0;
                const reviewed = total - due;
                const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

                return (
                  <div
                    key={deck.id}
                    className="app-panel p-4 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {editingDeckId === deck.id ? (
                          <div className="space-y-2">
                            <Input
                              value={editingDeckName}
                              onChange={(e) => setEditingDeckName(e.target.value)}
                              placeholder="Deck name"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                disabled={savingDeckId === deck.id}
                                onClick={() => void handleDeckRename(deck)}
                              >
                                {savingDeckId === deck.id ? "Saving…" : "Save"}
                              </Button>
                              <Button
                                type="button"
                                disabled={savingDeckId === deck.id}
                                onClick={resetDeckEditing}
                                variant="secondary"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Link
                            href={getDeckHref(deck.id)}
                            className="block transition duration-fast hover:opacity-80"
                          >
                            <div className="font-semibold">{deck.name}</div>
                            <div className="text-sm text-text-muted">
                              {due} card{due === 1 ? "" : "s"} due
                              {total > 0 ? ` · ${total} total` : ""}
                            </div>
                          </Link>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {due > 0 ? (
                          <Link
                            href={getDeckStudyHref(deck.id)}
                            className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                          >
                            Study
                          </Link>
                        ) : total > 0 ? (
                          <Button
                            type="button"
                            disabled={reattemptingDeckId === deck.id}
                            onClick={() => void handleReattempt(deck)}
                            variant="warm"
                          >
                            {reattemptingDeckId === deck.id ? "Resetting…" : "Reattempt"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          disabled={deletingDeckId === deck.id}
                          onClick={() => {
                            setEditingDeckId(deck.id);
                            setEditingDeckName(deck.name);
                            setFeedback(null);
                          }}
                          variant="secondary"
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          disabled={deletingDeckId === deck.id}
                          onClick={() => void handleDeckDelete(deck)}
                          variant="danger"
                        >
                          {deletingDeckId === deck.id ? "Deleting…" : "Delete"}
                        </Button>
                      </div>
                    </div>

                    {/* Due progress bar */}
                    {total > 0 ? (
                      <ProgressBar progress={progressPct} className="mt-4" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
      </AppPage>
    </Refreshable>
  );

  async function handleCreate() {
    const deckName = name.trim();
    if (!deckName) return;

    setIsCreatingDeck(true);
    setFeedback(null);

    try {
      const newDeck = await createDeck(user.uid, deckName);
      setDecks((prev) => [newDeck, ...prev]);
      setName("");
      setFeedback({ type: "success", message: `Created deck ${deckName}.` });
    } catch (e) {
      console.error(e);
      setFeedback({ type: "error", message: "Error creating deck. Please try again." });
    } finally {
      setIsCreatingDeck(false);
    }
  }
}

