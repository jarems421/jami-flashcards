import { addDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  mapMasteryEventData,
  type MasteryEvent,
  type MasteryEventSourceType,
  type MasteryEventWeight,
} from "@/lib/practice/mastery";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function masteryCollection(userId: string) {
  return collection(db, "users", userId, "masteryEvents");
}

export async function recordMasteryEvent(
  userId: string,
  input: {
    topicId: string;
    sourceType: MasteryEventSourceType;
    sourceId?: string;
    weight: MasteryEventWeight;
    scoreDelta?: number;
    reason: string;
    algorithmVersion: string;
    createdAt?: number;
  }
) {
  if (!input.topicId.trim()) return null;

  const docRef = await withTimeout(
    addDoc(masteryCollection(userId), {
      topicId: input.topicId,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      weight: input.weight,
      scoreDelta: input.scoreDelta ?? 0,
      reason: input.reason.slice(0, 240),
      algorithmVersion: input.algorithmVersion,
      createdAt: input.createdAt ?? Date.now(),
    }),
    WRITE_MS,
    "Record mastery event"
  );

  return docRef.id;
}

export async function getMasteryEvents(userId: string): Promise<MasteryEvent[]> {
  const snapshot = await withTimeout(
    getDocs(query(masteryCollection(userId), orderBy("createdAt", "desc"))),
    LOAD_MS,
    "Load mastery events"
  );

  return snapshot.docs.map((eventDoc) =>
    mapMasteryEventData(eventDoc.id, eventDoc.data() as Record<string, unknown>)
  );
}
