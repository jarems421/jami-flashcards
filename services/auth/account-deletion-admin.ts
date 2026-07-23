import "server-only";

import { FieldPath, type DocumentReference } from "firebase-admin/firestore";
import {
  executeAccountDeletion,
  getAccountStoragePrefixes,
  type AccountDeletionInventory,
} from "@/lib/auth/account-deletion";
import {
  getAdminAuth,
  getAdminDb,
  getAdminStorageBucket,
} from "@/services/firebase/admin";

const DELETE_CONCURRENCY = 12;

const ROOT_OWNER_QUERIES = [
  { collection: "cards", field: "userId" },
  { collection: "cards", field: "uid" },
  { collection: "decks", field: "userId" },
  { collection: "decks", field: "uid" },
] as const;

const UID_PREFIXED_COLLECTIONS = ["aiBudgets", "rateLimits"] as const;

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
}

async function runWithConcurrency<T>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<void>
) {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), values.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < values.length) {
        const value = values[cursor];
        cursor += 1;
        await operation(value);
      }
    })
  );
}

async function inventoryOwnedRootDocuments(uid: string) {
  const db = getAdminDb();
  const snapshots = await Promise.all([
    ...ROOT_OWNER_QUERIES.map(({ collection, field }) =>
      db.collection(collection).where(field, "==", uid).get()
    ),
    ...UID_PREFIXED_COLLECTIONS.map((collection) => {
      const prefix = `${uid}:`;
      return db
        .collection(collection)
        .where(FieldPath.documentId(), ">=", prefix)
        .where(FieldPath.documentId(), "<=", `${prefix}\uf8ff`)
        .get();
    }),
  ]);

  return Array.from(
    new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.docs.map((document) => document.ref.path)
      )
    )
  );
}

async function inventoryUserCollections(uid: string) {
  const userRef = getAdminDb().collection("users").doc(uid);
  const collections = await userRef.listCollections();
  const snapshots = await Promise.all(
    collections.map(async (collection) => ({
      path: collection.path,
      snapshot: await collection.select().get(),
    }))
  );

  return Object.fromEntries(
    snapshots.map(({ path, snapshot }) => [path, snapshot.size])
  );
}

async function inventoryStorageObjects(uid: string) {
  const bucket = getAdminStorageBucket();
  const fileGroups = await Promise.all(
    getAccountStoragePrefixes(uid).map(async (prefix) => {
      const [files] = await bucket.getFiles({ prefix });
      return files.map((file) => file.name);
    })
  );

  return Array.from(new Set(fileGroups.flat()));
}

export async function inventoryAccountData(
  uid: string
): Promise<AccountDeletionInventory> {
  const [rootDocumentPaths, userCollectionCounts, storageObjectPaths] =
    await Promise.all([
      inventoryOwnedRootDocuments(uid),
      inventoryUserCollections(uid),
      inventoryStorageObjects(uid),
    ]);

  return {
    rootDocumentPaths,
    userCollectionCounts,
    storageObjectPaths,
  };
}

async function deleteStorageObjects(paths: readonly string[]) {
  const bucket = getAdminStorageBucket();
  await runWithConcurrency(paths, DELETE_CONCURRENCY, async (path) => {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
    } catch (error) {
      if (getErrorCode(error) !== "404") throw error;
    }
  });
}

async function deleteDocumentTree(reference: DocumentReference) {
  await getAdminDb().recursiveDelete(reference);
}

async function deleteRootDocumentTrees(paths: readonly string[]) {
  const db = getAdminDb();
  await runWithConcurrency(paths, DELETE_CONCURRENCY, async (path) => {
    await deleteDocumentTree(db.doc(path));
  });
}

async function deleteUserDocumentTree(uid: string) {
  await deleteDocumentTree(getAdminDb().collection("users").doc(uid));
}

async function deleteAuthUser(uid: string) {
  try {
    await getAdminAuth().deleteUser(uid);
  } catch (error) {
    if (getErrorCode(error) !== "auth/user-not-found") throw error;
  }
}

export async function deleteAccountWithAdmin(uid: string) {
  return executeAccountDeletion(uid, {
    inventory: inventoryAccountData,
    deleteStorageObjects,
    deleteRootDocumentTrees,
    deleteUserDocumentTree,
    deleteAuthUser,
  });
}
