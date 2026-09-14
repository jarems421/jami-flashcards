/**
 * An image on the front or back of a flashcard.
 *
 * The card keeps where the file is and how big it is, never the file or a
 * download URL: a URL is a bearer token, and a path is useless to anyone the
 * Storage rules do not already let in.
 */
export type CardImage = {
  storagePath: string;
  /** Pixel size, or 0 where the browser could not read it. */
  width: number;
  height: number;
};

/**
 * An image as a form holds it: one the card already has, or a file chosen and
 * not yet uploaded. Nothing is uploaded until the card is saved, so abandoning
 * a form leaves nothing behind in Storage.
 */
export type CardImageDraft =
  | { kind: "saved"; image: CardImage }
  | { kind: "new"; file: File; previewUrl: string };

export const CARD_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const CARD_IMAGE_ACCEPT = CARD_IMAGE_MIME_TYPES.join(",");
/** Matches the Storage rule for `cardImages`. */
export const MAX_CARD_IMAGE_BYTES = 10 * 1024 * 1024;

export function cardImageStoragePrefix(userId: string) {
  return `users/${userId}/cardImages/`;
}

export function getCardImageFileError(file: { type: string; size: number }) {
  if (!(CARD_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Use a JPEG, PNG or WebP image.";
  }
  if (file.size === 0) return "That image is empty.";
  if (file.size > MAX_CARD_IMAGE_BYTES) return "Images must be 10 MB or smaller.";
  return null;
}

/**
 * A stored image reference, or nothing.
 *
 * Only a path inside the card owner's own image folder is accepted. Anything
 * else could not be read anyway, and would otherwise be handed to the delete
 * that runs when the card goes.
 */
export function normalizeCardImage(value: unknown, userId: string): CardImage | undefined {
  if (!value || typeof value !== "object" || !userId) return undefined;
  const input = value as Record<string, unknown>;
  const storagePath = typeof input.storagePath === "string" ? input.storagePath : "";
  if (
    !storagePath.startsWith(cardImageStoragePrefix(userId)) ||
    storagePath.includes("..") ||
    storagePath.length > 400
  ) {
    return undefined;
  }
  const dimension = (raw: unknown) =>
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  return { storagePath, width: dimension(input.width), height: dimension(input.height) };
}

export function cardImageDraftFrom(image: CardImage | undefined): CardImageDraft | undefined {
  return image ? { kind: "saved", image } : undefined;
}

/** Whether a draft still holds exactly the image the card has. */
export function isUnchangedCardImageDraft(
  draft: CardImageDraft | undefined,
  saved: CardImage | undefined
) {
  if (!draft) return !saved;
  return draft.kind === "saved" && draft.image.storagePath === saved?.storagePath;
}
