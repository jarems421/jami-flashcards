import { doc, runTransaction, type Transaction } from "firebase/firestore";
import { db } from "@/services/firebase/client";

export type StudyCommitIdentity = { userId: string; commitId: string };

/** The effect and its receipt commit together. A retry never repeats an increment. */
export async function commitStudyEffect<T>(
  identity: StudyCommitIdentity,
  effect: string,
  apply: (transaction: Transaction) => Promise<T>
): Promise<T> {
  const key = encodeURIComponent(`${identity.commitId}:${effect}`);
  const receipt = doc(db, "users", identity.userId, "studyState", `commit-${key}`);
  return runTransaction(db, async (transaction) => {
    const previous = await transaction.get(receipt);
    if (previous.exists()) return previous.data().result as T;
    const result = await apply(transaction);
    // Receipts contain effect results only, never a student's raw response.
    const stored = result === undefined ? null : JSON.parse(JSON.stringify(result));
    transaction.set(receipt, { result: stored, createdAt: Date.now() });
    return result;
  });
}
