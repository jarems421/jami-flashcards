import type { PracticePaperGenerationRequest } from "@/lib/ai/practice-paper-generation";
import {
  MAX_PRACTICE_PAPER_SOURCE_IDS,
  type PracticePaperJob,
  type PracticePaperTimingMode,
} from "@/lib/practice/practice-papers";
import { createPracticePaperJob } from "@/services/ai/practice-papers";
import { importUploadedNotebook } from "@/services/study/notebook-import";
import { deleteNotebookFile } from "@/services/study/notebook-files";
import { deleteNotebookImportRecords } from "@/services/study/notebooks";
import { createUploadedPracticePaper } from "@/services/study/practice-papers";
import { createUploadedSource } from "@/services/study/source-upload";
import { deleteSource } from "@/services/study/sources";
import { deleteSourceFile } from "@/services/study/source-files";

/**
 * The two ways the practice paper builder makes a paper.
 *
 * Each is a few writes that either all land or are taken back: a request that
 * fails part-way leaves no temporary files, half-imported notebook or orphaned
 * mark scheme behind in the student's folder.
 */

async function removeUploadedSource(userId: string, source: { id: string; storagePath: string }) {
  await Promise.all([
    deleteSourceFile(source.storagePath).catch(() => undefined),
    deleteSource(userId, source.id).catch(() => undefined),
  ]);
}

/**
 * Asks Jami to build a paper, with files the student added for this build
 * only. Those are uploaded as temporary sources the job removes once the
 * paper is built; if the request is refused, they are removed here.
 */
export async function requestGeneratedPracticePaper(input: {
  userId: string;
  request: PracticePaperGenerationRequest;
  supportingFiles: readonly File[];
}): Promise<PracticePaperJob> {
  const temporarySources: Array<{ id: string; storagePath: string }> = [];
  try {
    for (const file of input.supportingFiles) {
      const uploaded = await createUploadedSource({
        userId: input.userId,
        folderId: input.request.folderId,
        title: `Temporary paper context: ${file.name}`,
        file,
      });
      temporarySources.push({ id: uploaded.id, storagePath: uploaded.storagePath });
    }
    const temporaryIds = temporarySources.map((source) => source.id);
    return await createPracticePaperJob(
      { ...input.request, sourceIds: [...input.request.sourceIds, ...temporaryIds] },
      crypto.randomUUID(),
      temporaryIds
    );
  } catch (error) {
    await Promise.all(temporarySources.map((source) => removeUploadedSource(input.userId, source)));
    throw error;
  }
}

/**
 * Makes a practice paper from a real paper the student already has: the file
 * becomes a notebook they write on, and an official mark scheme, when they
 * add one, is kept as a source and attached first so marking reads it.
 *
 * Returns the notebook the paper opens in.
 */
export async function createUploadedPracticePaperFromFiles(input: {
  userId: string;
  folderId: string;
  title: string;
  paperFile: File;
  markSchemeFile: File | null;
  /** The folder's sources the student attached, with the labels shown for them. */
  sourceIds: string[];
  sourceLabels: string[];
  durationMinutes: number;
  timingMode: PracticePaperTimingMode;
  tutorEnabled: boolean;
  onProgress: (progress: number) => void;
}): Promise<{ notebookId: string }> {
  let imported: Awaited<ReturnType<typeof importUploadedNotebook>> | null = null;
  let markScheme: Awaited<ReturnType<typeof createUploadedSource>> | null = null;
  try {
    imported = await importUploadedNotebook({
      userId: input.userId,
      folderId: input.folderId,
      title: input.title,
      file: input.paperFile,
      color: "indigo",
      icon: "notebook",
      onProgress: input.onProgress,
    });
    if (input.markSchemeFile) {
      markScheme = await createUploadedSource({
        userId: input.userId,
        folderId: input.folderId,
        title: `${input.title} mark scheme`,
        file: input.markSchemeFile,
        onProgress: input.onProgress,
      });
    }
    let { sourceIds, sourceLabels } = input;
    if (markScheme && !sourceIds.includes(markScheme.id)) {
      sourceIds = [markScheme.id, ...sourceIds].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS);
      sourceLabels = [markScheme.title, ...sourceLabels].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS);
    }
    await createUploadedPracticePaper({
      userId: input.userId,
      notebook: imported.notebook,
      sourceIds,
      sourceLabels,
      markSchemeSourceId: markScheme?.id,
      durationMinutes: input.durationMinutes,
      timingMode: input.timingMode,
      tutorEnabled: input.tutorEnabled,
    });
    return { notebookId: imported.notebook.id };
  } catch (error) {
    if (markScheme) await removeUploadedSource(input.userId, markScheme);
    if (imported) {
      const { notebook, file } = imported;
      await Promise.all([
        deleteNotebookImportRecords(input.userId, notebook.id).catch(() => undefined),
        deleteNotebookFile(file.storagePath).catch(() => undefined),
      ]);
    }
    throw error;
  }
}
