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
import { useUser } from "@/lib/user-context";
import {
  createDeck,
  deleteDeck,
  getDecks,
  reattemptDeck,
  renameDeck,
  type Deck,
} from "@/services/decks";
import { getTagSuggestions, normalizeCardTags } from "@/lib/cards";
import { db } from "@/services/firebase";
import { FirebaseError } from "firebase/app";
import Refreshable, { RefreshIconButton } from "@/components/Refreshable";
import { removeUserTag, renameUserTag } from "@/services/tags";

type DeckDueCounts = Record<string, number>;
type DeckTotalCounts = Record<string, number>;
type TagCounts = Record<string, number>;
type Feedback = { type: "success" | "error"; message: string };

export default function DecksPage() {
  const router = useRouter();
  const { user, refreshKey } = useUser();

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
  }, [user.uid, loadAll, refreshKey]);

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
      <main
        data-app-surface="true"
        className="min-h-screen px-3 py-2 text-white sm:px-4 sm:py-3 md:px-6 md:py-4"
      >
        <div className="mx-auto max-w-3xl">
          {/* ── Header ── */}
          <div className="mb-3 flex items-center justify-between sm:mb-4">
            <h1 className="text-xl font-bold">Decks</h1>
            <RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />
          </div>

          {/* ── Feedback ── */}
          {feedback ? (
            <div
              className={`mb-3 flex items-center justify-between gap-4 rounded-xl p-2.5 text-sm sm:mb-4 sm:p-3 ${
                feedback.type === "error"
                  ? "bg-error-muted text-red-200"
                  : "bg-success-muted text-emerald-200"
              }`}
            >
              <div>{feedback.message}</div>
              <button
                onClick={() => setFeedback(null)}
                className="rounded-md bg-glass-medium px-3 py-1 text-xs hover:bg-glass-strong active:scale-[0.97]"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* ── Due summary ── */}
          <div
            className="mb-4 rounded-xl border border-white/[0.07] p-3 sm:p-4"
            style={{ backgroundImage: "var(--gradient-card)" }}
          >
            <div className="mb-1 text-xs font-semibold text-text-muted">Total cards due</div>
            <div className="text-2xl font-bold">{dueCount}</div>
          </div>

          <div
            className="mb-4 rounded-xl border border-white/[0.07] p-3 sm:p-4"
            style={{ backgroundImage: "var(--gradient-card)" }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-text-muted">Study by tag</div>
                <p className="text-sm text-text-secondary">
                  Group cards from different decks by topic, then study only those tags.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedTags.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTags([])}
                    className="rounded-md bg-glass-medium px-3 py-1.5 text-sm hover:bg-glass-strong"
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={selectedTags.length === 0}
                  onClick={handleStudySelectedTags}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold transition duration-fast hover:bg-accent-hover disabled:opacity-50"
                >
                  Study selected tags
                </button>
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
                        className={`rounded-full border px-3 py-1.5 text-left text-sm transition duration-fast ${
                          selected
                            ? "border-accent bg-accent/20 text-accent"
                            : "border-border bg-glass-medium text-white hover:bg-glass-strong"
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

                <div className="rounded-xl border border-white/[0.07] bg-glass-subtle p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-text-muted">Manage tags</div>
                      <p className="text-sm text-text-secondary">
                        Rename a tag, merge it into another one, or remove it from every card.
                      </p>
                    </div>
                    {renamingTag ? (
                      <button
                        type="button"
                        onClick={cancelTagRename}
                        className="rounded-md bg-glass-medium px-3 py-1.5 text-sm hover:bg-glass-strong"
                      >
                        Cancel rename
                      </button>
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
                        <div key={`manage-${tag}`} className="rounded-lg border border-white/[0.06] bg-glass-medium p-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-medium">#{tag}</div>
                              <div className="text-xs text-text-muted">{due} due · {total} total</div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingTag(tag);
                                  setRenamingTagValue(tag);
                                  setFeedback(null);
                                }}
                                className="rounded-md bg-glass-medium px-3 py-1.5 text-sm hover:bg-glass-strong"
                              >
                                Rename or merge
                              </button>
                              <button
                                type="button"
                                disabled={removingTag === tag}
                                onClick={() => void handleRemoveTag(tag)}
                                className="rounded-md bg-error/80 px-3 py-1.5 text-sm hover:bg-error disabled:opacity-50"
                              >
                                {removingTag === tag ? "Removing…" : "Remove from cards"}
                              </button>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="mt-3 space-y-3 rounded-lg border border-white/[0.06] bg-glass-subtle p-3">
                              <div className="space-y-2">
                                <label className="block text-xs font-semibold text-text-muted">
                                  Rename or merge into
                                </label>
                                <input
                                  value={renamingTagValue}
                                  onChange={(event) => setRenamingTagValue(event.target.value)}
                                  className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                                  placeholder="Type a replacement tag"
                                />
                              </div>

                              {renameSuggestions.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {renameSuggestions.map((suggestion) => (
                                    <button
                                      key={`${tag}-${suggestion}`}
                                      type="button"
                                      onClick={() => setRenamingTagValue(suggestion)}
                                      className="rounded-full border border-border bg-glass-medium px-3 py-1 text-xs text-text-muted hover:bg-glass-strong"
                                    >
                                      Merge into #{suggestion}
                                    </button>
                                  ))}
                                </div>
                              ) : null}

                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={savingTag === tag}
                                  onClick={() => void handleSaveTagRename()}
                                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold transition duration-fast hover:bg-accent-hover disabled:opacity-50"
                                >
                                  {savingTag === tag ? "Saving…" : "Save tag change"}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingTag === tag}
                                  onClick={cancelTagRename}
                                  className="rounded-md bg-glass-medium px-3 py-1.5 text-sm hover:bg-glass-strong disabled:opacity-50"
                                >
                                  Cancel
                                </button>
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
          </div>

          {/* ── Create deck ── */}
          <div className="mb-4 flex gap-2">
            <input
              placeholder="New deck name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              className="w-full max-w-xs rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none transition duration-fast focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              disabled={isCreatingDeck || !name.trim()}
              onClick={() => void handleCreate()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition duration-fast hover:bg-accent-hover active:scale-[0.97] disabled:opacity-50"
            >
              {isCreatingDeck ? "Creating…" : "Create"}
            </button>
          </div>

          {/* ── Deck list ── */}
          {isLoadingDecks ? (
            <p className="text-sm text-text-muted">Loading decks…</p>
          ) : decks.length === 0 ? (
            <div
              className="rounded-xl border border-warm-border bg-warm-glow p-4 text-center"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              <p className="mb-2 text-sm text-text-secondary">
                No decks yet. Create your first deck above to get started.
              </p>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-3">
              {decks.map((deck) => {
                const due = deckDueCounts[deck.id] ?? 0;
                const total = deckTotalCounts[deck.id] ?? 0;
                const reviewed = total - due;
                const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

                return (
                  <div
                    key={deck.id}
                    className="rounded-xl border border-white/[0.07] p-2.5 sm:p-3 md:p-4"
                    style={{ backgroundImage: "var(--gradient-card)" }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {editingDeckId === deck.id ? (
                          <div className="space-y-2">
                            <input
                              value={editingDeckName}
                              onChange={(e) => setEditingDeckName(e.target.value)}
                              className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={savingDeckId === deck.id}
                                onClick={() => void handleDeckRename(deck)}
                                className="rounded-md bg-accent px-3 py-1.5 text-sm active:scale-[0.97] disabled:opacity-50"
                              >
                                {savingDeckId === deck.id ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={savingDeckId === deck.id}
                                onClick={resetDeckEditing}
                                className="rounded-md bg-glass-medium px-3 py-1.5 text-sm active:scale-[0.97] disabled:opacity-50 hover:bg-glass-strong"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <Link
                            href={`/deck/${deck.id}`}
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
                            href={`/deck/${deck.id}/study`}
                            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold transition duration-fast hover:bg-accent-hover active:scale-[0.97]"
                          >
                            Study
                          </Link>
                        ) : total > 0 ? (
                          <button
                            type="button"
                            disabled={reattemptingDeckId === deck.id}
                            onClick={() => void handleReattempt(deck)}
                            className="rounded-md bg-warm-accent px-3 py-1.5 text-sm font-semibold text-surface-base transition duration-fast hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
                          >
                            {reattemptingDeckId === deck.id ? "Resetting…" : "Reattempt"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={deletingDeckId === deck.id}
                          onClick={() => {
                            setEditingDeckId(deck.id);
                            setEditingDeckName(deck.name);
                            setFeedback(null);
                          }}
                          className="rounded-md bg-glass-medium px-3 py-1.5 text-sm active:scale-[0.97] disabled:opacity-50 hover:bg-glass-strong"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={deletingDeckId === deck.id}
                          onClick={() => void handleDeckDelete(deck)}
                          className="rounded-md bg-error/80 px-3 py-1.5 text-sm active:scale-[0.97] disabled:opacity-50 hover:bg-error"
                        >
                          {deletingDeckId === deck.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>

                    {/* Due progress bar */}
                    {total > 0 ? (
                      <div className="mt-2 h-1.5 rounded-full bg-glass-medium">
                        <div
                          className="h-1.5 rounded-full bg-gradient-to-r from-accent to-success transition-all duration-slow"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
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
