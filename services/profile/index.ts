import { deleteField, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";

export const MAX_USERNAME_LENGTH = 32;

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function sanitizeUsername(value: string) {
  return normalizeUsername(value).slice(0, MAX_USERNAME_LENGTH);
}

export async function loadInAppUsername(userId: string): Promise<string | null> {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data() as Record<string, unknown>;
  const username =
    typeof data.username === "string" ? sanitizeUsername(data.username) : "";
  return username || null;
}

export async function saveInAppUsername(userId: string, username: string) {
  const nextUsername = sanitizeUsername(username);
  const userRef = doc(db, "users", userId);
  await setDoc(
    userRef,
    {
      username: nextUsername ? nextUsername : deleteField(),
      updatedAt: Date.now(),
    },
    { merge: true }
  );

  return nextUsername || null;
}
