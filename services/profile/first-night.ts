import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { readFirstNightState, type FirstNightState } from "@/lib/onboarding/first-night";

const FIRST_NIGHT_DOCUMENT_ID = "first-night";

function firstNightRef(userId: string) {
  return doc(db, "users", userId, "onboarding", FIRST_NIGHT_DOCUMENT_ID);
}

/** The account's copy of the walkthrough, or null if it has never been saved. */
export async function loadFirstNight(userId: string): Promise<FirstNightState | null> {
  const snapshot = await getDoc(firstNightRef(userId));
  return snapshot.exists() ? readFirstNightState(snapshot.data()) : null;
}

export async function saveFirstNight(userId: string, state: FirstNightState) {
  await setDoc(firstNightRef(userId), state, { merge: false });
}
