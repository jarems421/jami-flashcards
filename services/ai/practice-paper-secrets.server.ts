import "server-only";

import {
  mapPracticePaperData,
  normalizePracticePaperMarkScheme,
  toPublicPracticePaperMarkScheme,
  type PracticePaper,
  type PracticePaperMarkScheme,
} from "@/lib/practice/practice-papers";
import { getAdminDb } from "@/services/firebase/admin";

export function practicePaperSecretRef(uid: string, paperId: string) {
  return getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("practicePaperSecrets")
    .doc(paperId);
}

export async function savePracticePaperSecret(input: {
  uid: string;
  paperId: string;
  markScheme: PracticePaperMarkScheme;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  await practicePaperSecretRef(input.uid, input.paperId).set(
    {
      paperId: input.paperId,
      markScheme: input.markScheme,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
}

export async function loadPracticePaperWithSecret(input: {
  uid: string;
  paperId: string;
  paperData: Record<string, unknown>;
}): Promise<PracticePaper> {
  const paper = mapPracticePaperData(input.paperId, input.paperData);
  const secretSnapshot = await practicePaperSecretRef(
    input.uid,
    input.paperId
  ).get();
  const secretScheme = secretSnapshot.exists
    ? normalizePracticePaperMarkScheme(
        secretSnapshot.data()?.markScheme,
        paper.questions
      )
    : null;
  const legacyScheme = normalizePracticePaperMarkScheme(
    input.paperData.markScheme,
    paper.questions
  );
  const markScheme = secretScheme?.items.length
    ? secretScheme
    : legacyScheme.items.length
      ? legacyScheme
      : paper.markScheme;
  return { ...paper, markScheme };
}

/**
 * Moves an older answer-bearing public rubric into the private collection.
 * This is intentionally idempotent so an authenticated read can safely heal
 * pre-cutover records before returning their public projection.
 */
export async function migrateLegacyPracticePaperSecret(input: {
  uid: string;
  paperId: string;
  paperData: Record<string, unknown>;
}) {
  const paper = mapPracticePaperData(input.paperId, input.paperData);
  const legacyScheme = normalizePracticePaperMarkScheme(
    input.paperData.markScheme,
    paper.questions
  );
  if (legacyScheme.items.length === 0) return paper;

  const now = Date.now();
  const db = getAdminDb();
  const paperRef = db
    .collection("users")
    .doc(input.uid)
    .collection("pastPapers")
    .doc(input.paperId);
  const secretRef = practicePaperSecretRef(input.uid, input.paperId);
  const batch = db.batch();
  batch.set(
    secretRef,
    {
      paperId: input.paperId,
      markScheme: legacyScheme,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );
  batch.update(paperRef, {
    markScheme: toPublicPracticePaperMarkScheme(legacyScheme),
    updatedAt: now,
  });
  await batch.commit();
  return {
    ...paper,
    markScheme: toPublicPracticePaperMarkScheme(legacyScheme),
    updatedAt: now,
  };
}

