import {
  createStorageFileId,
  deleteStorageFile,
  uploadStorageFile,
} from "@/services/firebase/storage-files";
import { buildNotebookStoragePath } from "@/services/study/notebook-files";
import { updateNotebookPageImages } from "@/services/study/notebooks";
import {
  createCenteredNotebookImageRef,
  MAX_NOTEBOOK_IMAGE_REFS,
  type NotebookImageRef,
} from "@/lib/workspace/notebooks";
import {
  getNotebookPageImageDisplaySize,
  validateNotebookPageImage,
} from "@/lib/workspace/notebook-page-image-upload";

/**
 * The image's own pixel size, so it is placed at its real proportions.
 *
 * `createImageBitmap` is the cheap way to ask and is available everywhere this
 * runs. If it refuses -- a corrupt file, a format the decoder will not take --
 * the caller still gets a usable placement rather than an error, because being
 * slightly the wrong shape is a much smaller problem than not being added.
 */
async function readImageSize(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 4, height: 3 };
  }
}

/**
 * Uploads an image and places it on the current page as a movable figure.
 *
 * The record written is the same `NotebookImageRef` a Jami illustration
 * produces, so it inherits dragging, the resize handle and the page's own
 * conflict handling without any of that being built twice.
 *
 * The upload is undone if the page write fails. Otherwise a rejected write --
 * a full page, a revision conflict, a page deleted on another device -- would
 * leave a private object in Storage that nothing references and nothing will
 * ever clean up.
 */
export async function addUploadedImageToNotebookPage(input: {
  userId: string;
  notebookId: string;
  pageId: string;
  file: File;
  currentImageRefs: readonly NotebookImageRef[];
  baseContentRevision: number;
  onProgress?: (progress: number) => void;
}) {
  validateNotebookPageImage(input.file);
  if (input.currentImageRefs.length >= MAX_NOTEBOOK_IMAGE_REFS) {
    throw new Error(`This page can hold up to ${MAX_NOTEBOOK_IMAGE_REFS} images.`);
  }

  const fileId = createStorageFileId();
  const storagePath = buildNotebookStoragePath({
    userId: input.userId,
    notebookId: input.notebookId,
    fileId,
    fileName: input.file.name,
  });

  const intrinsic = await readImageSize(input.file);
  await uploadStorageFile({
    storagePath,
    file: input.file,
    contentType: input.file.type,
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });

  try {
    const display = getNotebookPageImageDisplaySize(intrinsic);
    const imageRef = createCenteredNotebookImageRef({
      id: `upload-${fileId}`,
      storagePath,
      width: intrinsic.width,
      height: intrinsic.height,
      altText: input.file.name,
    });
    const placed: NotebookImageRef = {
      ...imageRef,
      displayWidth: display.width,
      displayHeight: display.height,
    };

    return await updateNotebookPageImages(input.userId, {
      notebookId: input.notebookId,
      pageId: input.pageId,
      imageRefs: [...input.currentImageRefs, placed],
      baseContentRevision: input.baseContentRevision,
    });
  } catch (error) {
    await deleteStorageFile(storagePath).catch(() => undefined);
    throw error;
  }
}
