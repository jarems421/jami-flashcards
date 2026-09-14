// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { derivePhotoBackgroundPalette } from "@/lib/app/photo-background-palette";
import { PHOTO_BACKGROUND_STORAGE_KEY } from "@/lib/app/photo-background";

vi.mock("firebase/firestore", () => ({
  deleteField: vi.fn(),
  doc: vi.fn(() => ({})),
  // The account never answers, so only what happens before the read is seen.
  getDoc: vi.fn(() => new Promise(() => undefined)),
  setDoc: vi.fn(),
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: vi.fn(async () => undefined),
  getStorageFileDownloadUrl: vi.fn(async () => "https://files.test/background.jpg"),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  uploadStorageFile: vi.fn(async () => undefined),
}));

const { syncPhotoBackground } = await import("@/services/profile/photo-background");

function copyFor(userId: string) {
  const palette = derivePhotoBackgroundPalette(Array.from({ length: 64 }, () => [20, 30, 60, 255]).flat());
  return JSON.stringify({
    userId,
    imageUrl: "https://files.test/background.jpg",
    storagePath: `users/${userId}/appBackgrounds/f1/background.jpg`,
    scheme: palette.scheme,
    vars: palette.vars,
    updatedAt: 1,
    focusX: 50,
    focusY: 50,
    zoom: 1,
  });
}

beforeEach(() => {
  localStorage.clear();
});

/*
 * On a shared device the next person to sign in used to sit in front of the
 * last person's photo until their own account had been read.
 */
describe("syncing on a shared device", () => {
  it("drops another account's photo before reading this account", () => {
    localStorage.setItem(PHOTO_BACKGROUND_STORAGE_KEY, copyFor("bob"));
    void syncPhotoBackground("alice");
    expect(localStorage.getItem(PHOTO_BACKGROUND_STORAGE_KEY)).toBeNull();
  });

  it("keeps this account's own copy on screen while the account is read", () => {
    localStorage.setItem(PHOTO_BACKGROUND_STORAGE_KEY, copyFor("alice"));
    void syncPhotoBackground("alice");
    expect(localStorage.getItem(PHOTO_BACKGROUND_STORAGE_KEY)).not.toBeNull();
  });
});
