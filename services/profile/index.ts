import { deleteField, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  normalizeStudyLevel,
  type StudyLevel,
} from "@/lib/profile/study-level";
import {
  normalizeReasoningEffort,
  type ReasoningEffortPreference,
} from "@/lib/profile/reasoning-effort";

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
  invalidateDashboardData(userId);

  return nextUsername || null;
}

export async function loadReasoningEffort(
  userId: string
): Promise<ReasoningEffortPreference | null> {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) return null;

  return normalizeReasoningEffort(snapshot.data().reasoningEffort) ?? null;
}

export async function saveReasoningEffort(
  userId: string,
  effort: ReasoningEffortPreference | null
) {
  const normalized = normalizeReasoningEffort(effort);
  await setDoc(
    doc(db, "users", userId),
    {
      reasoningEffort: normalized ?? deleteField(),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  invalidateDashboardData(userId);

  return normalized ?? null;
}

export async function loadDefaultStudyLevel(
  userId: string
): Promise<StudyLevel | null> {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) return null;

  return normalizeStudyLevel(snapshot.data().defaultStudyLevel) ?? null;
}

export async function saveDefaultStudyLevel(
  userId: string,
  level: StudyLevel | null
) {
  const normalizedLevel = normalizeStudyLevel(level);
  await setDoc(
    doc(db, "users", userId),
    {
      defaultStudyLevel: normalizedLevel ?? deleteField(),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  invalidateDashboardData(userId);

  return normalizedLevel ?? null;
}
