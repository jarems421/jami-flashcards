import { clearDeviceCopies, readDeviceCopy, writeDeviceCopy } from "@/services/cache/device-store";
import { mapCardData, type Card } from "@/lib/study/cards";

/**
 * A student's cards, kept on this device so pages can be drawn before the
 * server's copy arrives.
 *
 * A student with thousands of cards waited ten to twenty seconds on every page
 * that needs all of them -- Cards, Progress, Topics, Today -- because each page
 * load fetched the whole set again. With this copy those pages draw at once
 * from what the device last saw, and the server's set replaces it moments
 * later. It is a convenience, never the truth: any write by the student drops
 * it, so a page never shows their own edit undone, and only a set read with no
 * write in between is kept.
 */

/** Old enough to be a different term's cards: start from the server instead. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "cards:";

/** As read back from the device: the cards are checked one by one, not trusted. */
type DeviceCardSet = { userId: string; savedAt: number; cards: unknown[] };

function copyKey(userId: string) {
  return `${PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDeviceCardSet(value: unknown): value is DeviceCardSet {
  return (
    isRecord(value) &&
    typeof value.userId === "string" &&
    typeof value.savedAt === "number" &&
    Array.isArray(value.cards)
  );
}

/** The cards this device last saw for `userId`, or null if it has none worth showing. */
export async function readDeviceCardSet(userId: string, now = Date.now()): Promise<Card[] | null> {
  const value = await readDeviceCopy(copyKey(userId));
  if (!isDeviceCardSet(value) || value.userId !== userId || now - value.savedAt > MAX_AGE_MS) return null;
  // Read back through the same mapping as the server's cards: a copy written
  // by an older version of the app comes back in today's shape.
  return value.cards.flatMap((card) =>
    isRecord(card) && typeof card.id === "string" ? [mapCardData(card.id, card)] : []
  );
}

export function keepDeviceCardSet(userId: string, cards: Card[]) {
  return writeDeviceCopy(copyKey(userId), { userId, savedAt: Date.now(), cards });
}

/** Drops the copy for one student, or for everyone on this device. */
export function forgetDeviceCardSets(userId?: string) {
  return clearDeviceCopies(userId ? copyKey(userId) : PREFIX);
}
