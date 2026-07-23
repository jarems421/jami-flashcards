import { describe, expect, it, vi } from "vitest";
import {
  executeAccountDeletion,
  getAccountStoragePrefixes,
  hasRecentAuthentication,
  type AccountDeletionDependencies,
  type AccountDeletionInventory,
} from "@/lib/auth/account-deletion";

const inventory: AccountDeletionInventory = {
  rootDocumentPaths: ["cards/card-a", "decks/deck-a"],
  userCollectionCounts: {
    "users/user-a/notebooks": 2,
    "users/user-a/tutorMessages": 3,
  },
  storageObjectPaths: [
    "users/user-a/notebookFiles/notebook-a/file.pdf",
    "profilePhotos/user-a/avatar.webp",
  ],
};

function createDependencies(events: string[]): AccountDeletionDependencies {
  return {
    inventory: vi.fn(async () => {
      events.push("inventory");
      return inventory;
    }),
    deleteStorageObjects: vi.fn(async () => {
      events.push("storage");
    }),
    deleteRootDocumentTrees: vi.fn(async () => {
      events.push("root-documents");
    }),
    deleteUserDocumentTree: vi.fn(async () => {
      events.push("user-tree");
    }),
    deleteAuthUser: vi.fn(async () => {
      events.push("auth-user");
    }),
  };
}

describe("account deletion", () => {
  it("requires a recent authentication time", () => {
    expect(hasRecentAuthentication(1_000, 1_299)).toBe(true);
    expect(hasRecentAuthentication(1_000, 1_301)).toBe(false);
    expect(hasRecentAuthentication(undefined, 1_001)).toBe(false);
    expect(hasRecentAuthentication(1_100, 1_000)).toBe(false);
  });

  it("keeps all owned uploads within explicit user prefixes", () => {
    expect(getAccountStoragePrefixes("user-a")).toEqual([
      "users/user-a/",
      "profilePhotos/user-a/",
    ]);
  });

  it("deletes storage and Firestore before deleting Auth", async () => {
    const events: string[] = [];
    const report = await executeAccountDeletion(
      "user-a",
      createDependencies(events)
    );

    expect(events).toEqual([
      "inventory",
      "storage",
      "root-documents",
      "user-tree",
      "auth-user",
    ]);
    expect(report).toEqual({
      rootDocuments: 2,
      userCollections: 2,
      userDocuments: 5,
      storageObjects: 2,
    });
  });

  it("preserves the Auth identity when cleanup stops early", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    dependencies.deleteRootDocumentTrees = vi.fn(async () => {
      events.push("root-documents");
      throw new Error("Firestore unavailable");
    });

    await expect(
      executeAccountDeletion("user-a", dependencies)
    ).rejects.toThrow("Firestore unavailable");
    expect(events).toEqual(["inventory", "storage", "root-documents"]);
    expect(dependencies.deleteAuthUser).not.toHaveBeenCalled();
  });
});
