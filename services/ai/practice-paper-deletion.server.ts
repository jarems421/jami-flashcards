import "server-only";

import type { DocumentReference } from "firebase-admin/firestore";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { cleanTemporaryPracticePaperSources } from "@/services/ai/practice-paper-workflow.server";

const DELETE_BATCH_SIZE = 400;

export type PracticePaperDeletionReport = {
  deleted: true;
  alreadyDeleted: boolean;
  paperId: string;
  notebookId: string;
  deletedDocuments: number;
  deletedStoragePrefixes: number;
};

export class PracticePaperDeletionError extends Error {
  readonly code: "paper_not_found" | "invalid_paper_link";
  readonly status: 404 | 409;

  constructor(
    code: PracticePaperDeletionError["code"],
    message: string,
    status: PracticePaperDeletionError["status"]
  ) {
    super(message);
    this.name = "PracticePaperDeletionError";
    this.code = code;
    this.status = status;
  }
}

function normalizedId(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value)
    ? value
    : "";
}

function uniqueDocumentReferences(references: DocumentReference[]) {
  return [...new Map(references.map((reference) => [reference.path, reference])).values()];
}

async function deleteReferences(references: DocumentReference[]) {
  const db = getAdminDb();
  const unique = uniqueDocumentReferences(references);
  for (let offset = 0; offset < unique.length; offset += DELETE_BATCH_SIZE) {
    const batch = db.batch();
    unique.slice(offset, offset + DELETE_BATCH_SIZE).forEach((reference) => {
      batch.delete(reference);
    });
    await batch.commit();
  }
  return unique.length;
}

function notebookCanBelongToPaper(
  paperId: string,
  data: Record<string, unknown>
) {
  return (
    data.type === "practice_paper" ||
    data.type === "past_paper" ||
    data.pastPaperId === paperId
  );
}

/**
 * Permanently removes one formal paper and every server-owned child record.
 *
 * Dependent data and storage are removed before the two identity documents.
 * A failed partial run therefore leaves a root record that makes the same
 * authenticated request safely retryable. Once both roots are absent, a
 * repeated request is an idempotent no-op.
 */
export async function deletePracticePaperWithAdmin(
  uid: string,
  paperId: string
): Promise<PracticePaperDeletionReport> {
  const normalizedUid = uid.trim();
  const normalizedPaperId = normalizedId(paperId);
  if (!normalizedUid || !normalizedPaperId) {
    throw new PracticePaperDeletionError(
      "paper_not_found",
      "Practice paper not found",
      404
    );
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(normalizedUid);
  const paperRef = userRef.collection("pastPapers").doc(normalizedPaperId);
  const paperSnapshot = await paperRef.get();
  const paperData = paperSnapshot.data() ?? {};
  const linkedNotebookId = normalizedId(paperData.notebookId);
  const notebookId = linkedNotebookId || normalizedPaperId;
  const notebookRef = userRef.collection("notebooks").doc(notebookId);
  const notebookSnapshot = await notebookRef.get();

  if (!paperSnapshot.exists && !notebookSnapshot.exists) {
    return {
      deleted: true,
      alreadyDeleted: true,
      paperId: normalizedPaperId,
      notebookId,
      deletedDocuments: 0,
      deletedStoragePrefixes: 0,
    };
  }
  if (
    linkedNotebookId &&
    linkedNotebookId !== normalizedPaperId &&
    notebookSnapshot.data()?.pastPaperId !== normalizedPaperId
  ) {
    throw new PracticePaperDeletionError(
      "invalid_paper_link",
      "This paper has an invalid notebook link and was not deleted.",
      409
    );
  }
  if (
    notebookSnapshot.exists &&
    !notebookCanBelongToPaper(normalizedPaperId, notebookSnapshot.data() ?? {})
  ) {
    throw new PracticePaperDeletionError(
      "invalid_paper_link",
      "This notebook is not a formal practice paper and was not deleted.",
      409
    );
  }

  const [pages, inks, files, attempts, deadlineSnapshots, jobs] = await Promise.all([
    userRef.collection("notebookPages").where("notebookId", "==", notebookId).get(),
    userRef.collection("notebookPageInk").where("notebookId", "==", notebookId).get(),
    userRef.collection("notebookFiles").where("notebookId", "==", notebookId).get(),
    userRef.collection("practicePaperAttempts").where("paperId", "==", normalizedPaperId).get(),
    userRef.collection("practicePaperDeadlineSnapshots").where("paperId", "==", normalizedPaperId).get(),
    userRef.collection("practicePaperJobs").where("paperId", "==", normalizedPaperId).get(),
  ]);

  // A queued paper may own temporary source uploads. Remove those while its
  // private job record is still available, then cancel/delete the job itself.
  await Promise.all(
    jobs.docs.map((job) =>
      cleanTemporaryPracticePaperSources(normalizedUid, job.id)
    )
  );

  const generatedAssetsPrefix =
    `users/${normalizedUid}/generatedPaperAssets/${normalizedPaperId}/`;
  const notebookFilesPrefix = `users/${normalizedUid}/notebookFiles/${notebookId}/`;
  const notebookImagesPrefix = `users/${normalizedUid}/notebookImages/${notebookId}/`;
  const prefixes = [
    generatedAssetsPrefix,
    notebookFilesPrefix,
    notebookImagesPrefix,
  ];
  const bucket = getAdminStorageBucket();
  await Promise.all(
    prefixes.map((prefix) =>
      bucket.deleteFiles({ prefix, force: true })
    )
  );

  const dependentReferences: DocumentReference[] = [
    ...pages.docs.map((page) => page.ref),
    ...pages.docs.map((page) => userRef.collection("notebookPageInk").doc(page.id)),
    ...inks.docs.map((ink) => ink.ref),
    ...files.docs.map((file) => file.ref),
    ...attempts.docs.map((attempt) => attempt.ref),
    ...deadlineSnapshots.docs.map((snapshot) => snapshot.ref),
    ...jobs.docs.map((job) => userRef.collection("practicePaperJobArtifacts").doc(job.id)),
    ...jobs.docs.map((job) => job.ref),
    userRef.collection("practicePaperSecrets").doc(normalizedPaperId),
  ];
  const deletedDependents = await deleteReferences(dependentReferences);

  // Delete the identity records together and last. If anything above fails,
  // at least one root remains so the exact same request can resume cleanup.
  const finalReferences = uniqueDocumentReferences([paperRef, notebookRef]);
  const deletedRoots = await deleteReferences(finalReferences);

  return {
    deleted: true,
    alreadyDeleted: false,
    paperId: normalizedPaperId,
    notebookId,
    deletedDocuments: deletedDependents + deletedRoots,
    deletedStoragePrefixes: prefixes.length,
  };
}
