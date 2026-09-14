import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardImage } from "@/lib/study/card-images";

const storage = vi.hoisted(() => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: vi.fn<(path: string) => Promise<undefined>>(async () => undefined),
  getStorageFileDownloadUrl: vi.fn(async (path: string) => `https://files.test/${path}`),
  getStorageUploadErrorMessage: vi.fn(() => "The image could not upload."),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: vi.fn<(input: { storagePath: string }) => Promise<undefined>>(
    async () => undefined
  ),
}));

vi.mock("@/services/firebase/storage-files", () => storage);

const { cardSaveErrorMessage, commitCardImageDrafts } = await import(
  "@/services/study/card-images"
);

const OLD: CardImage = {
  storagePath: "users/user-1/cardImages/old/heart.png",
  width: 400,
  height: 300,
};

function newDraft(name = "heart.png", type = "image/png") {
  return { kind: "new" as const, file: new File(["png"], name, { type }), previewUrl: "blob:preview" };
}

beforeEach(() => {
  Object.values(storage).forEach((mock) => mock.mockClear());
});

describe("saving a card's images", () => {
  it("uploads a new image before the card is written, and writes only the side that changed", async () => {
    const write = vi.fn(async () => "saved");
    const saved = await commitCardImageDrafts({
      userId: "user-1",
      drafts: { frontImage: newDraft() },
      write,
    });

    expect(storage.uploadStorageFile).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: "users/user-1/cardImages/file-1/heart.png" })
    );
    expect(write).toHaveBeenCalledWith({
      frontImage: { storagePath: "users/user-1/cardImages/file-1/heart.png", width: 0, height: 0 },
    });
    expect(saved.result).toBe("saved");
    expect(storage.deleteStorageFile).not.toHaveBeenCalled();
  });

  it("removes the upload again when the card cannot be saved", async () => {
    await expect(
      commitCardImageDrafts({
        userId: "user-1",
        drafts: { backImage: newDraft() },
        write: async () => {
          throw new Error("offline");
        },
      })
    ).rejects.toThrow("offline");

    expect(storage.deleteStorageFile).toHaveBeenCalledWith("users/user-1/cardImages/file-1/heart.png");
  });

  it("deletes an image the card let go of, once the card has saved", async () => {
    const write = vi.fn(async () => undefined);
    await commitCardImageDrafts({
      userId: "user-1",
      drafts: {},
      previous: { frontImage: OLD },
      write,
    });

    expect(write).toHaveBeenCalledWith({ frontImage: null });
    expect(storage.deleteStorageFile).toHaveBeenCalledWith(OLD.storagePath);
  });

  it("leaves an unchanged image alone and writes nothing about it", async () => {
    const write = vi.fn(async () => undefined);
    await commitCardImageDrafts({
      userId: "user-1",
      drafts: { backImage: { kind: "saved", image: OLD } },
      previous: { backImage: OLD },
      write,
    });

    expect(write).toHaveBeenCalledWith({});
    expect(storage.uploadStorageFile).not.toHaveBeenCalled();
    expect(storage.deleteStorageFile).not.toHaveBeenCalled();
  });

  it("refuses a file it could never store, before uploading anything", async () => {
    const write = vi.fn(async () => undefined);
    await expect(
      commitCardImageDrafts({
        userId: "user-1",
        drafts: { frontImage: newDraft("clip.gif", "image/gif") },
        write,
      })
    ).rejects.toThrow("Use a JPEG, PNG or WebP image.");

    expect(storage.uploadStorageFile).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("explains an upload failure, and keeps the caller's words for anything else", () => {
    expect(cardSaveErrorMessage({ code: "storage/unauthorized" }, "Failed to add card.")).toBe(
      "The image could not upload."
    );
    expect(cardSaveErrorMessage(new Error("permission-denied"), "Failed to add card.")).toBe(
      "Failed to add card."
    );
  });
});
