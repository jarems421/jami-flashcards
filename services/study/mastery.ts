import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { peekCachedRead, readThroughCache, seedCachedRead } from "@/services/cache/read-through";
import { readDeviceCopy, writeDeviceCopy } from "@/services/cache/device-store";
import { isRecord, readOwnDataRoute, signedInStudent } from "@/services/study/own-data-route";
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

/** The events this device last saw, read back through the same mapping as the server's. */
async function readKeptMasteryEvents(userId: string): Promise<MasteryEvent[] | null> {
  const kept = await readDeviceCopy(deviceCopyKey(userId));
  if (!isRecord(kept) || kept.userId !== userId || !Array.isArray(kept.events)) return null;
  return kept.events.flatMap((event) =>
    isRecord(event) && typeof event.id === "string" ? [mapMasteryEventData(event.id, event)] : []
  );
}

async function loadMasteryEventsFromFirestore(userId: string): Promise<MasteryEvent[]> {
  const snapshot = await withTimeout(
    getDocs(query(masteryCollection(userId), orderBy("createdAt", "desc"))),
    LOAD_MS,
    "Load mastery events"
  );
  return snapshot.docs.map((eventDoc) =>
    mapMasteryEventData(eventDoc.id, eventDoc.data() as Record<string, unknown>)
  );
}

/**
 * Each topic's summed score as one entry, from the route that adds them up
 * beside the database. The sum per topic is all anything reads from these
 * events, so it is all that needs to cross the network.
 */
async function loadTopicSumsThroughRoute(student: NonNullable<ReturnType<typeof signedInStudent>>) {
  const body = await readOwnDataRoute(student, "/api/study/mastery-sums", "Load mastery events");
  if (!Array.isArray(body.topics)) throw new Error("Load mastery events: the route answered without topics.");
  return body.topics.flatMap((topic) =>
    isRecord(topic) && typeof topic.topicId === "string"
      ? [
          mapMasteryEventData(`topic-sum:${topic.topicId}`, {
            topicId: topic.topicId,
            scoreDelta: typeof topic.scoreDelta === "number" ? topic.scoreDelta : 0,
            createdAt: typeof topic.lastAt === "number" ? topic.lastAt : 0,
            reason: "Earlier practice, summed",
            algorithmVersion: "topic-sum",
          }),
        ]
      : []
  );
}

async function loadMasteryEventsFromServer(userId: string): Promise<MasteryEvent[]> {
  const student = signedInStudent(userId);
  let events: MasteryEvent[] | null = null;
  if (student) {
    try {
      events = await loadTopicSumsThroughRoute(student);
    } catch (error) {
      console.warn("Reading earlier practice through the server failed; reading it directly.", error);
    }
  }
  events ??= await loadMasteryEventsFromFirestore(userId);
  void writeDeviceCopy(deviceCopyKey(userId), { userId, events });
  return events;
}

/**
 * The student's scores from the early practice loop, one entry per topic.
 *
 * Nothing has written these since May, but Today still reads them, and a
 * student who used that loop heavily has thousands of events -- the biggest
 * download on Today after their cards. They are summed per topic on the
 * server, kept on the device, and refreshed quietly behind the page.
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
