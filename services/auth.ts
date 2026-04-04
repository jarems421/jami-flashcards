import { auth } from "./firebase";
import { db } from "./firebase";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  deleteUser,
} from "firebase/auth";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  query,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

const BATCH_DELETE_LIMIT = 400;

async function deleteSnapshotsInBatches(
  snapshots: QueryDocumentSnapshot[]
) {
  if (snapshots.length === 0) return;

  for (let index = 0; index < snapshots.length; index += BATCH_DELETE_LIMIT) {
    const batch = writeBatch(db);
    const chunk = snapshots.slice(index, index + BATCH_DELETE_LIMIT);
    for (const snapshot of chunk) {
      batch.delete(snapshot.ref);
    }

    await batch.commit();
  }
}

async function deleteCollectionDocs(pathSegments: string[]) {
  const snap = await getDocs(collection(db, pathSegments.join("/")));
  await deleteSnapshotsInBatches(snap.docs);
}

async function deleteUserOwnedDeckDocs(uid: string) {
  const decksCollection = collection(db, "decks");
  const [byUserId, byLegacyUid] = await Promise.all([
    getDocs(query(decksCollection, where("userId", "==", uid))),
    getDocs(query(decksCollection, where("uid", "==", uid))),
  ]);

  const dedupedDecks = new Map<string, QueryDocumentSnapshot>();
  for (const snapshot of [...byUserId.docs, ...byLegacyUid.docs]) {
    dedupedDecks.set(snapshot.id, snapshot);
  }

  await deleteSnapshotsInBatches(
    Array.from(dedupedDecks.values())
  );
}

async function deleteUserOwnedCardDocs(uid: string) {
  const cardsSnapshot = await getDocs(
    query(collection(db, "cards"), where("userId", "==", uid))
  );

  await deleteSnapshotsInBatches(cardsSnapshot.docs);
}

const provider = new GoogleAuthProvider();

export function createRetryableInitializer(initialize: () => Promise<void>) {
  let initializationPromise: Promise<void> | null = null;

  return async () => {
    if (!initializationPromise) {
      initializationPromise = initialize();
    }

    try {
      await initializationPromise;
    } catch (error) {
      // Allow retries after transient/local-storage failures.
      initializationPromise = null;
      throw error;
    }
  };
}

const ensureAuthInitialized = createRetryableInitializer(() =>
  setPersistence(auth, browserLocalPersistence)
);

// Ensure session persists
export const initAuth = async () => {
  await ensureAuthInitialized();
};

// Google sign-in — try popup first, fall back to redirect
export const signInWithGoogle = async () => {
  await initAuth();
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (popupError: unknown) {
    const code = (popupError as { code?: string }).code;
    // If popup was blocked or unavailable, fall back to redirect flow
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    ) {
      await signInWithRedirect(auth, provider);
      return null; // page will reload via redirect
    }
    throw popupError;
  }
};

// Handle redirect result on page load
export const handleGoogleRedirectResult = async () => {
  await initAuth();
  const result = await getRedirectResult(auth);
  return result?.user ?? null;
};

// Logout
export const logout = async () => {
  await signOut(auth);
};

// Email sign-up
export const signUpWithEmail = async (email: string, password: string) => {
  await initAuth();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
};

// Email sign-in
export const signInWithEmail = async (email: string, password: string) => {
  await initAuth();
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
};

// Delete user account + Firestore data under users/{uid}
export const deleteAccount = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("No authenticated user.");

  const uid = user.uid;

  // Delete nested attempt docs before deleting user deck records.
  const userDecksSnapshot = await getDocs(collection(db, "users", uid, "decks"));
  for (const deckDoc of userDecksSnapshot.docs) {
    await deleteCollectionDocs(["users", uid, "decks", deckDoc.id, "attempts"]);
  }

  await deleteUserOwnedCardDocs(uid);
  await deleteUserOwnedDeckDocs(uid);
  await deleteCollectionDocs(["users", uid, "stars"]);
  await deleteCollectionDocs(["users", uid, "dust"]);
  await deleteCollectionDocs(["users", uid, "goals"]);
  await deleteCollectionDocs(["users", uid, "notificationPreferences"]);
  await deleteCollectionDocs(["users", uid, "pushSubscriptions"]);
  await deleteCollectionDocs(["users", uid, "constellations"]);
  await deleteCollectionDocs(["users", uid, "constellationState"]);
  await deleteCollectionDocs(["users", uid, "decks"]);

  // Delete the user document itself
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid));
  await batch.commit();

  // Delete the Firebase Auth user
  await deleteUser(user);
};
