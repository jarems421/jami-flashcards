import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  mapMasteryEventData,
  type MasteryEvent,
} from "@/lib/material/mastery";

const LOAD_MS = 30_000;

function masteryCollection(userId: string) {
  return collection(db, "users", userId, "masteryEvents");
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
