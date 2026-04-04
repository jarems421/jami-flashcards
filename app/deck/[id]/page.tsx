"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { listenToAuth } from "@/lib/auth-listener";
import {
  addCardTag,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardTags,
  type Card,
} from "@/lib/cards";
import TagInput from "@/components/TagInput";
import { db } from "@/services/firebase";
import { User } from "firebase/auth";
import { getDeckById, type Deck } from "@/services/decks";

export default function DeckPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = params?.id;
  const deckId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");

  const [user, setUser] = useState<User | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [cardTags, setCardTags] = useState<string[]>([]);
  const [pendingTag, setPendingTag] = useState("");
  const [adding, setAdding] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingFront, setEditingFront] = useState("");
  const [editingBack, setEditingBack] = useState("");
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [editingPendingTag, setEditingPendingTag] = useState("");
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = listenToAuth((u) => {
      if (!u) {
        router.push("/");
        return;
      }
      setUser(u);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!user || !deckId) return;

    let cancelled = false;

    void (async () => {
      setLoadingCards(true);
      setFeedback(null);
      try {
        const ownedDeck = await getDeckById(user.uid, deckId);
        if (!ownedDeck) {
          if (!cancelled) {
            setDeck(null);
            setCards([]);
            setFeedback({
              type: "error",
              message: "Deck not found.",
            });
          }
          return;
        }

        const deckCardsQuery = query(
          collection(db, "cards"),
          where("deckId", "==", deckId),
          where("userId", "==", user.uid)
        );
        const userCardsQuery = query(
          collection(db, "cards"),
          where("userId", "==", user.uid)
        );
        const [snapshot, allUserCardsSnapshot] = await Promise.all([
          getDocs(deckCardsQuery),
          getDocs(userCardsQuery),
        ]);
        if (cancelled) return;
        const list: Card[] = snapshot.docs.map((cardDoc) =>
          mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
        );
        list.sort((a, b) => b.createdAt - a.createdAt);
        const nextAvailableTags = Array.from(
          new Set(
            allUserCardsSnapshot.docs.flatMap((cardDoc) =>
              normalizeCardTags(cardDoc.data().tags)
            )
          )
        ).sort((left, right) => left.localeCompare(right));
        setDeck(ownedDeck);
        setCards(list);
        setAvailableTags(nextAvailableTags);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setDeck(null);
          setAvailableTags([]);
          setFeedback({
            type: "error",
            message: "Failed to load cards.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingCards(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, deckId]);

  const resetEditingCard = () => {
    setEditingCardId(null);
    setEditingFront("");
    setEditingBack("");
    setEditingTags([]);
    setEditingPendingTag("");
    setSavingCardId(null);
  };

  return (
    <main
      data-app-surface="true"
      className="min-h-screen p-6 text-white"
    >
      <h1 className="mb-6 text-xl">{deck?.name ?? "Deck"}</h1>

      {deckId && deck ? (
        <Link
          href={`/deck/${deckId}/study`}
          className="mb-6 inline-block rounded-md bg-accent px-4 py-2 text-white transition duration-fast hover:bg-accent-hover"
        >
          Study this deck
        </Link>
      ) : null}

      {feedback ? (
        <div
          className={`mb-4 flex items-center justify-between gap-4 rounded p-3 ${
            feedback.type === "error"
              ? "bg-error-muted text-red-200"
              : "bg-success-muted text-emerald-200"
          }`}
        >
          <div>{feedback.message}</div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded-md bg-glass-medium px-3 py-1 text-xs hover:bg-glass-strong"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {deck ? (
        <div className="mb-6 flex max-w-md flex-col gap-2">
          <input
            placeholder="Front"
            value={front}
            onChange={(e) => setFront(e.target.value)}
            maxLength={MAX_FRONT_LENGTH}
            className="rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none transition duration-fast focus:border-accent"
          />
          <input
            placeholder="Back"
            value={back}
            onChange={(e) => setBack(e.target.value)}
            maxLength={MAX_BACK_LENGTH}
            className="rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none transition duration-fast focus:border-accent"
          />
          <TagInput
            tags={cardTags}
            pendingTag={pendingTag}
            availableTags={availableTags}
            onTagsChange={setCardTags}
            onPendingTagChange={setPendingTag}
            helperText="Reuse existing topics as you type, or add a new one for this card."
            disabled={adding}
          />
          <button
            type="button"
            disabled={adding || !user || !deckId || !deck}
            onClick={async () => {
              if (!user || !deckId || !deck) return;
              const f = front.trim();
              const b = back.trim();
              const tagResult = addCardTag(cardTags, pendingTag);
              if (!f || !b) {
                setFeedback({
                  type: "error",
                  message: "Both front and back are required.",
                });
                return;
              }
              if (tagResult.error) {
                setFeedback({
                  type: "error",
                  message: tagResult.error,
                });
                return;
              }
              if (f.length > MAX_FRONT_LENGTH || b.length > MAX_BACK_LENGTH) {
                setFeedback({
                  type: "error",
                  message: `Cards must stay under ${MAX_FRONT_LENGTH} characters on the front and ${MAX_BACK_LENGTH} on the back.`,
                });
                return;
              }

              setAdding(true);
              setFeedback(null);
              try {
                const createdAt = Date.now();
                const tags = tagResult.nextTags;
                const ref = await addDoc(collection(db, "cards"), {
                  deckId,
                  userId: user.uid,
                  front: f,
                  back: b,
                  tags,
                  createdAt,
                });
                setCards((prev) => [
                  {
                    id: ref.id,
                    deckId,
                    userId: user.uid,
                    front: f,
                    back: b,
                    tags,
                    createdAt,
                  },
                  ...prev,
                ]);
                setFront("");
                setBack("");
                setCardTags([]);
                setPendingTag("");
                setAvailableTags((prev) =>
                  Array.from(new Set([...prev, ...tags])).sort((left, right) =>
                    left.localeCompare(right)
                  )
                );
                setFeedback({
                  type: "success",
                  message: "Card added.",
                });
              } catch (e) {
                console.error(e);
                setFeedback({
                  type: "error",
                  message: "Failed to add card.",
                });
              } finally {
                setAdding(false);
              }
            }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition duration-fast hover:bg-accent-hover disabled:opacity-50"
          >
            Add Card
          </button>
        </div>
      ) : !loadingCards ? (
        <div className="max-w-md rounded-lg border border-border bg-glass-subtle p-4 text-sm text-text-muted">
          This deck does not exist or is no longer available.
        </div>
      ) : null}

      {deck && loadingCards ? (
        <p className="text-sm text-text-muted">Loading cards…</p>
      ) : deck && cards.length === 0 ? (
        <p className="text-sm text-text-muted">No cards yet. Add your first card above.</p>
      ) : deck ? (
        <ul className="max-w-2xl space-y-3">
          {cards.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-glass-subtle p-3">
              {editingCardId === c.id ? (
                <div className="space-y-3">
                  <input
                    value={editingFront}
                    onChange={(e) => setEditingFront(e.target.value)}
                    className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white outline-none focus:border-accent"
                  />
                  <input
                    value={editingBack}
                    onChange={(e) => setEditingBack(e.target.value)}
                    className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white outline-none focus:border-accent"
                  />
                  <TagInput
                    tags={editingTags}
                    pendingTag={editingPendingTag}
                    availableTags={availableTags}
                    onTagsChange={setEditingTags}
                    onPendingTagChange={setEditingPendingTag}
                    helperText="Suggestions come from tags you already use across all decks."
                    disabled={savingCardId === c.id}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={savingCardId === c.id}
                      onClick={async () => {
                        const nextFront = editingFront.trim();
                        const nextBack = editingBack.trim();
                        const tagResult = addCardTag(editingTags, editingPendingTag);

                        if (!nextFront || !nextBack) {
                          setFeedback({
                            type: "error",
                            message: "Both front and back are required.",
                          });
                          return;
                        }
                        if (tagResult.error) {
                          setFeedback({
                            type: "error",
                            message: tagResult.error,
                          });
                          return;
                        }

                        const nextTags = tagResult.nextTags;

                        setSavingCardId(c.id);
                        setFeedback(null);

                        try {
                          await updateDoc(doc(db, "cards", c.id), {
                            front: nextFront,
                            back: nextBack,
                            tags: nextTags,
                          });
                          setCards((prev) =>
                            prev.map((card) =>
                              card.id === c.id
                                ? {
                                    ...card,
                                    front: nextFront,
                                    back: nextBack,
                                    tags: nextTags,
                                  }
                                : card
                            )
                          );
                          setAvailableTags((prev) =>
                            Array.from(new Set([...prev, ...nextTags])).sort((left, right) =>
                              left.localeCompare(right)
                            )
                          );
                          resetEditingCard();
                          setFeedback({
                            type: "success",
                            message: "Card updated.",
                          });
                        } catch (e) {
                          console.error(e);
                          setSavingCardId(null);
                          setFeedback({
                            type: "error",
                            message: "Failed to update card.",
                          });
                        }
                      }}
                      className="rounded-md bg-accent px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {savingCardId === c.id ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={savingCardId === c.id}
                      onClick={resetEditingCard}
                      className="rounded-md bg-glass-medium px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-glass-strong"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div>{c.front}</div>
                    <div className="text-text-muted">{c.back}</div>
                    {c.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {c.tags.map((tag) => (
                          <Link
                            key={tag}
                            href={`/deck/${deckId}/study?tags=${encodeURIComponent(tag)}`}
                            className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent transition duration-fast hover:bg-accent/20"
                          >
                            #{tag}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={deletingCardId === c.id}
                      onClick={() => {
                        setEditingCardId(c.id);
                        setEditingFront(c.front);
                        setEditingBack(c.back);
                        setEditingTags(c.tags);
                        setEditingPendingTag("");
                        setFeedback(null);
                      }}
                      className="rounded-md bg-glass-medium px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-glass-strong"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={deletingCardId === c.id}
                      onClick={async () => {
                        const shouldDelete = window.confirm(
                          "Delete this card?"
                        );
                        if (!shouldDelete) return;

                        setDeletingCardId(c.id);
                        setFeedback(null);

                        try {
                          await deleteDoc(doc(db, "cards", c.id));
                          setCards((prev) =>
                            prev.filter((card) => card.id !== c.id)
                          );
                          if (editingCardId === c.id) {
                            resetEditingCard();
                          }
                          setFeedback({
                            type: "success",
                            message: "Card deleted.",
                          });
                        } catch (e) {
                          console.error(e);
                          setFeedback({
                            type: "error",
                            message: "Failed to delete card.",
                          });
                        } finally {
                          setDeletingCardId(null);
                        }
                      }}
                      className="rounded-md bg-error/80 px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-error"
                    >
                      {deletingCardId === c.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
