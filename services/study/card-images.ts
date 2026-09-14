import {
  createStorageFileId,
  deleteStorageFile,
  getStorageFileDownloadUrl,
  getStorageUploadErrorMessage,
  sanitizeStorageFileName,
  uploadStorageFile,
} from "@/services/firebase/storage-files";
import {
  cardImageStoragePrefix,
  getCardImageFileError,
  type CardImage,
  type CardImageDraft,
} from "@/lib/study/card-images";

async function readImageSize(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // A card still shows an image whose size could not be read; it is only
    // laid out without a reserved shape until it loads.
    return { width: 0, height: 0 };
  }
}

export async function uploadCardImage(userId: string, file: File): Promise<CardImage> {
  const problem = getCardImageFileError(file);
  if (problem) throw new Error(problem);
  const storagePath = `${cardImageStoragePrefix(userId)}${createStorageFileId()}/${sanitizeStorageFileName(file.name, "card-image")}`;
  const size = await readImageSize(file);
  await uploadStorageFile({ storagePath, file, contentType: file.type });
  return { storagePath, ...size };
}

/** Best effort: a file that will not delete is not worth failing the card over. */
export async function deleteCardImageFiles(
  images: ReadonlyArray<CardImage | null | undefined>
) {
  const paths = [...new Set(images.flatMap((image) => (image ? [image.storagePath] : [])))];
  await Promise.all(paths.map((path) => deleteStorageFile(path).catch(() => undefined)));
}

export type CardImageDrafts = {
  frontImage?: CardImageDraft;
  backImage?: CardImageDraft;
};

/** Only the sides that changed: an image to set, or null to clear one. */
export type CardImageChanges = {
  frontImage?: CardImage | null;
  backImage?: CardImage | null;
};

/**
 * Save a card's images around the write that saves the card.
 *
 * New files are uploaded first, because the card has to point at something
 * that exists. If the card then fails to save, those uploads are removed again;
 * if it saves, any image the card let go of -- replaced or removed -- is
 * removed instead. Either way Storage ends holding exactly what cards refer to.
 *
 * Uploads run one after the other so that a failure cannot leave a second
 * upload finishing after the clean-up has already run.
 */
export async function commitCardImageDrafts<T>(input: {
  userId: string;
  drafts: CardImageDrafts;
  previous?: { frontImage?: CardImage; backImage?: CardImage };
  write: (changes: CardImageChanges) => Promise<T>;
}): Promise<{ result: T; frontImage?: CardImage; backImage?: CardImage }> {
  const uploaded: CardImage[] = [];
  const resolve = async (draft: CardImageDraft | undefined) => {
    if (!draft) return undefined;
    if (draft.kind === "saved") return draft.image;
    const image = await uploadCardImage(input.userId, draft.file);
    uploaded.push(image);
    return image;
  };

  let frontImage: CardImage | undefined;
  let backImage: CardImage | undefined;
  let result: T;
  try {
    frontImage = await resolve(input.drafts.frontImage);
    backImage = await resolve(input.drafts.backImage);
    const changes: CardImageChanges = {};
    if (frontImage?.storagePath !== input.previous?.frontImage?.storagePath) {
      changes.frontImage = frontImage ?? null;
    }
    if (backImage?.storagePath !== input.previous?.backImage?.storagePath) {
      changes.backImage = backImage ?? null;
    }
    result = await input.write(changes);
  } catch (error) {
    await deleteCardImageFiles(uploaded);
    throw error;
  }

  const kept = new Set([frontImage?.storagePath, backImage?.storagePath]);
  await deleteCardImageFiles(
    [input.previous?.frontImage, input.previous?.backImage].filter(
      (image) => image && !kept.has(image.storagePath)
    )
  );
  return { result, frontImage, backImage };
}

/** Frees the local preview a chosen-but-unsaved file holds. */
export function releaseCardImageDraft(draft: CardImageDraft | undefined) {
  if (draft?.kind === "new") URL.revokeObjectURL(draft.previewUrl);
}

/** An upload failure says what went wrong; anything else keeps the caller's words. */
export function cardSaveErrorMessage(error: unknown, fallback: string) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  return code.startsWith("storage/") ? getStorageUploadErrorMessage(error, "image") : fallback;
}

const downloadUrls = new Map<string, Promise<string>>();

/**
 * A viewable URL for a stored card image, asked for once per image.
 *
 * A study session shows the same cards repeatedly, so the lookup is kept for
 * the page's lifetime. A failed lookup is forgotten, so going back online can
 * still load it.
 */
export function getCardImageUrl(storagePath: string) {
  let pending = downloadUrls.get(storagePath);
  if (!pending) {
    pending = getStorageFileDownloadUrl(storagePath);
    downloadUrls.set(storagePath, pending);
    pending.catch(() => downloadUrls.delete(storagePath));
  }
  return pending;
}
