import { commitStudyEffect } from "@/services/study/commit-effect";
import type { CardRating, updateCardSchedule } from "@/lib/study/scheduler";
import type { StudySessionKind } from "@/lib/study/session";

export type StudyCommitIntent = {
  commitId: string; cardId: string; rating: CardRating; answeredAt: number;
  sessionKind: StudySessionKind; responseTimeMs?: number; requeueOnMiss?: boolean;
  context: { deckId: string; topicIds: string[]; folderIds: string[] };
  schedule: ReturnType<typeof updateCardSchedule> | null;
};

/** Persist the choice before effects start; retry never creates a second choice. */
export async function reserveStudyCommit(uid: string, proposed: StudyCommitIntent, offline: boolean): Promise<StudyCommitIntent> {
  const key = `jami:study-commit:${uid}:${proposed.commitId}`;
  let intent = proposed;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as StudyCommitIntent;
      if (saved.commitId === proposed.commitId && saved.cardId === proposed.cardId && saved.sessionKind === proposed.sessionKind) intent = saved;
    }
    localStorage.setItem(key, JSON.stringify(intent));
  } catch {
    if (offline) throw new Error("Your answer could not be saved on this device. Please reconnect before continuing.");
  }
  if (!offline) {
    intent = await commitStudyEffect({ userId: uid, commitId: proposed.commitId }, "intent", async () => intent);
    if (intent.cardId !== proposed.cardId || intent.sessionKind !== proposed.sessionKind) throw new Error("This saved answer belongs to another exercise.");
    try { localStorage.setItem(key, JSON.stringify(intent)); } catch { /* Server receipt is durable. */ }
  }
  return intent;
}

export function clearStudyCommitDraft(uid: string, commitId: string) {
  try { localStorage.removeItem(`jami:study-commit:${uid}:${commitId}`); } catch { /* Best effort cleanup. */ }
}
