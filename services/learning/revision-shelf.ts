import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import {
  buildRevisionShelfWrite,
  decodeRevisionShelfItem,
  REVISION_SHELF_COLLECTION,
  REVISION_SHELF_LIMIT,
  type RevisionShelfItem,
  type RevisionShelfStatus,
} from "@/lib/revision/shelf";
import type { RevisionNextStep } from "@/lib/revision/types";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

/**
 * The Tutor shelf, read and written by its owner.
 *
 * Client-written, unlike a session: an item here is the student's own note of
 * something they meant to do, not evidence of anything, and the rules check its
 * shape. See `lib/revision/shelf.ts`.
 */

const SHELF_MS = 15_000;

function shelf(uid: string) {
  return collection(db, "users", uid, REVISION_SHELF_COLLECTION);
}

export async function listRevisionShelf(uid: string): Promise<RevisionShelfItem[]> {
  const snapshot = await withTimeout(
    getDocs(query(shelf(uid), orderBy("createdAt", "desc"), limit(REVISION_SHELF_LIMIT))),
    SHELF_MS,
    "Load revision shelf"
  );
  return snapshot.docs.flatMap((document) => {
    const item = decodeRevisionShelfItem(document.id, document.data());
    return item ? [item] : [];
  });
}

/** Keep a next step, or a thing Jami made, on the shelf. */
export async function addToRevisionShelf(
  uid: string,
  step: Pick<RevisionNextStep, "kind" | "topicKey" | "conceptLabel" | "folderId" | "conceptId" | "href">,
  status: RevisionShelfStatus
): Promise<void> {
  const write = buildRevisionShelfWrite({ ...step, status }, Date.now());
  if (!write) throw new Error("That couldn't be saved.");
  await withTimeout(addDoc(shelf(uid), write), SHELF_MS, "Save to revision shelf");
}

export async function removeFromRevisionShelf(uid: string, itemId: string): Promise<void> {
  await withTimeout(deleteDoc(doc(shelf(uid), itemId)), SHELF_MS, "Remove from revision shelf");
}
