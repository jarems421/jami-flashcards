import { readDeviceCopy, writeDeviceCopy } from "@/services/cache/device-store";
import { mapCardData, type Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import { normalizeDeckColorPreset, normalizeDeckIconPreset } from "@/lib/study/deck-style";
import {
  forgetLegacyOfflineStudySnapshot,
  loadLegacyOfflineStudySnapshot,
  saveLegacyOfflineStudySnapshot,
  type OfflineStudySnapshot,
} from "@/lib/study/offline-study";

/**
 * What Learn needs to carry on without a connection: the student's cards and
 * decks as last seen.
 *
 * Kept in IndexedDB. It was kept in localStorage, written whole -- every card,
 * stringified on the main thread -- when Learn opened and again after every
 * Simple Study answer. For a student with thousands of cards that froze the
 * page each time and then failed anyway, because the set was larger than
 * localStorage allows, so they had no offline copy at all. Writes are now
 * gathered and made at most once every second and a half, off the critical
 * path, with no size limit worth the name.
 */

const WRITE_DELAY_MS = 1_500;
const pending = new Map<string, { snapshot: OfflineStudySnapshot; timer: ReturnType<typeof setTimeout> }>();

function copyKey(userId: string) {
  return `offline-study:${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readDeck(value: unknown): Deck[] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.userId !== "string") return [];
  return [
    {
      id: value.id,
      name: typeof value.name === "string" ? value.name : "Untitled",
      userId: value.userId,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
      colorPreset: normalizeDeckColorPreset(typeof value.colorPreset === "string" ? value.colorPreset : null),
      iconPreset: normalizeDeckIconPreset(typeof value.iconPreset === "string" ? value.iconPreset : null),
      ...(typeof value.styleVersion === "string" ? { styleVersion: value.styleVersion } : {}),
      folderIds: Array.isArray(value.folderIds)
        ? value.folderIds.filter((folderId): folderId is string => typeof folderId === "string")
        : [],
    },
  ];
}

function readCard(value: unknown): Card[] {
  return isRecord(value) && typeof value.id === "string" ? [mapCardData(value.id, value)] : [];
}

/** Keeps the latest cards and decks for offline study, written shortly after the last change. */
export function keepOfflineStudySnapshot(userId: string, contents: { cards: Card[]; decks: Deck[] }) {
  const snapshot: OfflineStudySnapshot = { userId, savedAt: Date.now(), ...contents };
  const existing = pending.get(userId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(userId);
    if (typeof indexedDB === "undefined") {
      // No IndexedDB here: the old place is better than nothing.
      saveLegacyOfflineStudySnapshot(snapshot);
      return;
    }
    void writeDeviceCopy(copyKey(userId), snapshot).then(() => forgetLegacyOfflineStudySnapshot(userId));
  }, WRITE_DELAY_MS);
  pending.set(userId, { snapshot, timer });
}

/**
 * The newest offline snapshot there is: one still waiting to be written, the
 * device's copy, or one an older version of the app left in localStorage.
 */
export async function readOfflineStudySnapshot(userId: string): Promise<OfflineStudySnapshot | null> {
  const waiting = pending.get(userId);
  if (waiting) return waiting.snapshot;

  const kept = await readDeviceCopy(copyKey(userId));
  if (
    isRecord(kept) &&
    kept.userId === userId &&
    typeof kept.savedAt === "number" &&
    Array.isArray(kept.cards) &&
    Array.isArray(kept.decks)
  ) {
    return {
      userId,
      savedAt: kept.savedAt,
      cards: kept.cards.flatMap(readCard),
      decks: kept.decks.flatMap(readDeck),
    };
  }
  return loadLegacyOfflineStudySnapshot(userId);
}
