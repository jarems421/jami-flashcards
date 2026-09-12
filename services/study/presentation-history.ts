import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { getCardContentHash, isStudyMode, type StudyMode } from "@/lib/study/study-modes";
import type { Card } from "@/lib/study/cards";
import { withTimeout } from "@/services/firebase/firestore";

export type PresentationHistoryEntry = {
  id: string; sourceHash: string; mode: StudyMode; variantId?: string;
  outcome: "correct" | "partial" | "incorrect" | "uncertain";
  assisted: boolean; at: number;
};

function clean(value: unknown): PresentationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is PresentationHistoryEntry => Boolean(v) && typeof v === "object" &&
    typeof v.id === "string" && typeof v.sourceHash === "string" && isStudyMode(v.mode) &&
    ["correct", "partial", "incorrect", "uncertain"].includes(v.outcome) &&
    typeof v.assisted === "boolean" && Number.isFinite(v.at)).slice(-8).map((v) => ({
      id: v.id.slice(0, 240), sourceHash: v.sourceHash, mode: v.mode,
      ...(typeof v.variantId === "string" ? { variantId: v.variantId.slice(0, 120) } : {}),
      outcome: v.outcome, assisted: v.assisted, at: v.at,
    }));
}
const key = (uid: string, cardId: string) => `jami:study-history:${uid}:${cardId}`;
const reference = (uid: string, cardId: string) => doc(db, "users", uid, "studyState", `presentations-${cardId}`);
function readLocal(uid: string, cardId: string) {
  try { return clean(JSON.parse(localStorage.getItem(key(uid, cardId)) ?? "[]")); } catch { return []; }
}
function writeLocal(uid: string, cardId: string, entries: PresentationHistoryEntry[]) {
  try { localStorage.setItem(key(uid, cardId), JSON.stringify(entries)); } catch { /* History is best effort offline. */ }
}
function merge(...sets: PresentationHistoryEntry[][]) {
  return [...new Map(sets.flat().map((entry) => [entry.id, entry])).values()].sort((a, b) => a.at - b.at).slice(-8);
}

export async function loadPresentationHistory(uid: string, cards: Card[]) {
  const variants: Record<string, string[]> = {};
  const outcomes: Record<string, Array<PresentationHistoryEntry["outcome"]>> = {};
  // Small batches keep a large review queue from opening hundreds of reads at once.
  const deadline = Date.now() + 1_500;
  for (let start = 0; start < cards.length; start += 10) {
    await Promise.all(cards.slice(start, start + 10).map(async (card) => {
      let entries = readLocal(uid, card.id);
      if (Date.now() < deadline && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        try {
          const snapshot = await withTimeout(getDoc(reference(uid, card.id)), Math.max(1, deadline - Date.now()), "Load presentation history");
          entries = merge(clean(snapshot.data()?.entries), entries);
          writeLocal(uid, card.id, entries);
        } catch { /* Cached history remains available offline. */ }
      }
      entries = entries.filter((entry) => entry.sourceHash === getCardContentHash(card));
      variants[card.id] = entries.flatMap((entry) => entry.variantId ? [entry.variantId] : []);
      outcomes[card.id] = entries.filter((entry) => !entry.assisted).slice(-5).map((entry) => entry.outcome);
    }));
  }
  return { variants, outcomes };
}

export async function recordPresentation(uid: string, cardId: string, entry: PresentationHistoryEntry) {
  if (!entry.variantId) delete entry.variantId;
  const local = merge(readLocal(uid, cardId), [entry]);
  writeLocal(uid, cardId, local);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try {
    await runTransaction(db, async (transaction) => {
      const ref = reference(uid, cardId);
      const snapshot = await transaction.get(ref);
      transaction.set(ref, { entries: merge(clean(snapshot.data()?.entries), local), updatedAt: Date.now() });
    });
  } catch { /* The next encounter merges the local history again. */ }
}
