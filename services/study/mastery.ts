import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { peekCachedRead, readThroughCache, seedCachedRead } from "@/services/cache/read-through";
import { readDeviceCopy, writeDeviceCopy } from "@/services/cache/device-store";
import {
  mapMasteryEventData,
  type MasteryEvent,
} from "@/lib/material/mastery";

const LOAD_MS = 30_000;

function masteryCollection(userId: string) {
  return collection(db, "users", userId, "masteryEvents");
}

function deviceCopyKey(userId: string) {
  return `mastery:${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The events this device last saw, read back through the same mapping as the server's. */
async function readKeptMasteryEvents(userId: string): Promise<MasteryEvent[] | null> {
  const kept = await readDeviceCopy(deviceCopyKey(userId));
  if (!isRecord(kept) || kept.userId !== userId || !Array.isArray(kept.events)) return null;
  return kept.events.flatMap((event) =>
    isRecord(event) && typeof event.id === "string" ? [mapMasteryEventData(event.id, event)] : []
  );
}

async function loadMasteryEventsFromServer(userId: string): Promise<MasteryEvent[]> {
  const snapshot = await withTimeout(
    getDocs(query(masteryCollection(userId), orderBy("createdAt", "desc"))),
    LOAD_MS,
    "Load mastery events"
  );
  const events = snapshot.docs.map((eventDoc) =>
    mapMasteryEventData(eventDoc.id, eventDoc.data() as Record<string, unknown>)
  );
  void writeDeviceCopy(deviceCopyKey(userId), { userId, events });
  return events;
}

/**
 * Every mastery event the student earned under the early practice loop.
 *
 * Nothing has written to this collection since May, but Today still reads the
 * whole of it, and for a student who used that loop heavily it was the second
 * biggest download on the page. Kept on the device, it costs nothing to show
 * and is refreshed quietly behind the page.
 */
export async function getMasteryEvents(userId: string): Promise<MasteryEvent[]> {
  const key = { collection: "masteryEvents", userId };
  const load = () => loadMasteryEventsFromServer(userId);
  if (!peekCachedRead(key)) {
    const kept = await readKeptMasteryEvents(userId);
    if (kept) seedCachedRead(key, kept, load);
  }
  return readThroughCache(key, load);
}
