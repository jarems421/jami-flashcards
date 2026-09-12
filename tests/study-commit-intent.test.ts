import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join("/"),
  runTransaction: async (_db: unknown, apply: (tx: unknown) => Promise<unknown>) => {
    const writes = new Map<string, unknown>();
    const result = await apply({ get: async (ref: string) => ({ exists: () => store.has(ref), data: () => store.get(ref) }), set: (ref: string, value: unknown) => writes.set(ref, value) });
    for (const [key, value] of writes) store.set(key, value);
    return result;
  },
}));
import { reserveStudyCommit, type StudyCommitIntent } from "@/services/study/commit-intent";
import { commitStudyEffect } from "@/services/study/commit-effect";
const intent: StudyCommitIntent = { commitId: "p", cardId: "c", rating: "again", answeredAt: 1, sessionKind: "custom", context: { deckId: "d", topicIds: [], folderIds: [] }, schedule: null };
beforeEach(() => { store.clear(); });
it("keeps the first rating and timestamp across tabs and retries", async () => {
  await reserveStudyCommit("u", intent, false);
  const retried = await reserveStudyCommit("u", { ...intent, rating: "good", answeredAt: 2 }, false);
  expect(retried.rating).toBe("again"); expect(retried.answeredAt).toBe(1);
});
it("retries a failed effect without repeating the successful effect", async () => {
  const identity = { userId: "u", commitId: "p" };
  const activity = vi.fn(async () => 1);
  await commitStudyEffect(identity, "activity", activity);
  await expect(commitStudyEffect(identity, "card", async () => { throw new Error("offline"); })).rejects.toThrow();
  await commitStudyEffect(identity, "activity", activity);
  expect(activity).toHaveBeenCalledTimes(1);
  expect(await commitStudyEffect(identity, "card", async () => 2)).toBe(2);
});
