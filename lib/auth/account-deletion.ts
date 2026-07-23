import "server-only";

export const MAX_RECENT_AUTH_AGE_SECONDS = 5 * 60;

export type AccountDeletionInventory = {
  rootDocumentPaths: string[];
  userCollectionCounts: Record<string, number>;
  storageObjectPaths: string[];
};

export type AccountDeletionReport = {
  rootDocuments: number;
  userCollections: number;
  userDocuments: number;
  storageObjects: number;
};

export type AccountDeletionDependencies = {
  inventory: (uid: string) => Promise<AccountDeletionInventory>;
  deleteStorageObjects: (paths: readonly string[]) => Promise<void>;
  deleteRootDocumentTrees: (paths: readonly string[]) => Promise<void>;
  deleteUserDocumentTree: (uid: string) => Promise<void>;
  deleteAuthUser: (uid: string) => Promise<void>;
};

export function hasRecentAuthentication(
  authTimeSeconds: number | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000),
  maxAgeSeconds = MAX_RECENT_AUTH_AGE_SECONDS
) {
  if (!Number.isFinite(authTimeSeconds)) return false;
  const ageSeconds = nowSeconds - Number(authTimeSeconds);
  return ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
}

export function getAccountStoragePrefixes(uid: string) {
  return [`users/${uid}/`, `profilePhotos/${uid}/`] as const;
}

export function toAccountDeletionReport(
  inventory: AccountDeletionInventory
): AccountDeletionReport {
  return {
    rootDocuments: inventory.rootDocumentPaths.length,
    userCollections: Object.keys(inventory.userCollectionCounts).length,
    userDocuments: Object.values(inventory.userCollectionCounts).reduce(
      (total, count) => total + count,
      0
    ),
    storageObjects: inventory.storageObjectPaths.length,
  };
}

/**
 * Deletes recoverable data first and the Firebase Auth identity last.
 * If an earlier step fails, the identity remains available so the same user
 * can retry the idempotent cleanup operation.
 */
export async function executeAccountDeletion(
  uid: string,
  dependencies: AccountDeletionDependencies
) {
  const inventory = await dependencies.inventory(uid);

  await dependencies.deleteStorageObjects(inventory.storageObjectPaths);
  await dependencies.deleteRootDocumentTrees(inventory.rootDocumentPaths);
  await dependencies.deleteUserDocumentTree(uid);
  await dependencies.deleteAuthUser(uid);

  return toAccountDeletionReport(inventory);
}
