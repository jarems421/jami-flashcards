import { createSource, deleteSource, updateSource } from "@/services/study/sources";
import {
  deleteSourceFile,
  uploadSourceFile,
  validateSourceUploadFile,
} from "@/services/study/source-files";

export async function createUploadedSource(input: {
  userId: string;
  folderId: string;
  title: string;
  file: File;
  onProgress?: (progress: number) => void;
}) {
  const fileType = validateSourceUploadFile(input.file);
  const sourceId = await createSource(input.userId, {
    title: input.title.trim() || input.file.name,
    type: "file",
    folderIds: [input.folderId],
    fileName: input.file.name,
    fileType: fileType || input.file.type,
    sizeBytes: input.file.size,
  });
  let storagePath = "";
  try {
    const uploaded = await uploadSourceFile({
      userId: input.userId,
      sourceId,
      file: input.file,
      onProgress: input.onProgress,
    });
    storagePath = uploaded.storagePath;
    await updateSource(input.userId, sourceId, uploaded);
    return {
      id: sourceId,
      title: input.title.trim() || input.file.name,
      ...uploaded,
    };
  } catch (error) {
    if (storagePath) await deleteSourceFile(storagePath).catch(() => undefined);
    await deleteSource(input.userId, sourceId).catch(() => undefined);
    throw error;
  }
}
