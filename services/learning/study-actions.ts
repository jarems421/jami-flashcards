import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { auth } from "@/services/firebase/client";

export type StudyActionsResponse = {
  actions: StudyAction[];
  folders: { id: string; name: string }[];
  generatedAt: number;
};

/**
 * How long one answer is reused within the session.
 *
 * Each request reads several folders' worth of evidence, and Today refreshes
 * on focus and navigation; recommendations do not need to change on every
 * visit. A pull-to-refresh asks again regardless.
 */
const STUDY_ACTIONS_CACHE_MS = 5 * 60_000;

const cache = new Map<string, { storedAt: number; value: StudyActionsResponse }>();

export function getCachedStudyActions(uid: string, now = Date.now()) {
  const entry = cache.get(uid);
  return entry && now - entry.storedAt < STUDY_ACTIONS_CACHE_MS ? entry.value : null;
}

function readResponse(body: unknown): StudyActionsResponse {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    actions: Array.isArray(record.actions) ? (record.actions as StudyAction[]) : [],
    folders: Array.isArray(record.folders) ? (record.folders as StudyActionsResponse["folders"]) : [],
    generatedAt: typeof record.generatedAt === "number" ? record.generatedAt : Date.now(),
  };
}

export async function loadStudyActionsForToday(
  options: { force?: boolean } = {}
): Promise<StudyActionsResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to load recommendations.");
  if (!options.force) {
    const cached = getCachedStudyActions(user.uid);
    if (cached) return cached;
  }
  const response = await fetch("/api/learning/study-actions", {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!response.ok) throw new Error("Recommendations are unavailable right now.");
  const value = readResponse(await response.json());
  cache.set(user.uid, { storedAt: Date.now(), value });
  return value;
}
