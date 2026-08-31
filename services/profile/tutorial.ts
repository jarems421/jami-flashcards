import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import {
  normalizeTutorialProgress,
  type TutorialProgress,
} from "@/lib/onboarding/tutorial";

const TUTORIAL_DOCUMENT_ID = "release-1";

function tutorialRef(userId: string) {
  return doc(db, "users", userId, "onboarding", TUTORIAL_DOCUMENT_ID);
}

/**
 * The account's copy of the walkthrough, or null if it has never been saved.
 *
 * Null rather than a fresh record: the caller holds a local copy too, and
 * "there is nothing stored" has to be distinguishable from "here is a record
 * written just now", or an account that has never seen the walkthrough would
 * always look newer than real progress made offline.
 */
export async function loadTutorialProgress(
  userId: string
): Promise<TutorialProgress | null> {
  const snapshot = await getDoc(tutorialRef(userId));
  return snapshot.exists() ? normalizeTutorialProgress(snapshot.data()) : null;
}

export async function saveTutorialProgress(
  userId: string,
  progress: TutorialProgress
) {
  await setDoc(tutorialRef(userId), progress, { merge: false });
  return progress;
}

