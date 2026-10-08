/**
 * Copies of pages kept on this device, so a page can be drawn the moment the
 * app opens rather than after its reads come back.
 *
 * A copy here is never the truth and is never written back anywhere. Whoever
 * reads one paints it, then loads the real thing behind it; anything that
 * cannot be read -- no IndexedDB, a private window, storage that refused or
 * was cleared -- simply means no copy, and the page loads as it always did.
 *
 * IndexedDB rather than localStorage because a copy can run to a megabyte, and
 * localStorage is shared with the notebook's emergency drafts, which must
 * never be crowded out by something that is only a convenience.
 */

const DATABASE_NAME = "jami-device-copies";
const STORE_NAME = "copies";

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open device copies."));
    request.onblocked = () => reject(new Error("Device copies are blocked."));
    request.onsuccess = () => {
      const database = request.result;
      // Kept open between reads, so the copy for the next page costs no open.
      // Another tab upgrading the database must not be held up by it.
      database.onversionchange = () => {
        database.close();
        if (opening === attempt) opening = null;
      };
      database.onclose = () => {
        if (opening === attempt) opening = null;
      };
      resolve(database);
    };
  });
  opening = attempt;
  attempt.catch(() => {
    if (opening === attempt) opening = null;
  });
  return attempt;
}

function settleRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Device copy request failed."));
  });
}

function settleTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Device copy failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Device copy was cancelled."));
  });
}

/** The copy under `key`, or null if there is none or it cannot be read. */
export async function readDeviceCopy(key: string): Promise<unknown> {
  try {
    const database = await openDatabase();
    const value = await settleRequest(
      database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)
    );
    return value ?? null;
  } catch {
    return null;
  }
}

/** Keeps `value` under `key`. A copy that cannot be kept is simply not kept. */
export async function writeDeviceCopy(key: string, value: unknown): Promise<void> {
  // No IndexedDB here at all: nothing is ever kept, and that is not news.
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = settleTransaction(transaction);
    transaction.objectStore(STORE_NAME).put(value, key);
    await done;
  } catch (error) {
    console.warn("Could not keep a copy of this page on the device.", error);
  }
}

/**
 * Forgets every copy whose key starts with `prefix`, or every copy at all.
 *
 * On sign-out, so the next person to use a shared device opens on nothing of
 * the last one's.
 */
export async function clearDeviceCopies(prefix = ""): Promise<void> {
  // No IndexedDB here at all means there is nothing to forget.
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    // The keys are read first and deleted in a transaction of their own:
    // nothing is awaited inside a transaction, which older Safari closes
    // early whenever a promise is.
    const keys = prefix
      ? (
          await settleRequest(
            database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys()
          )
        ).filter((key): key is string => typeof key === "string" && key.startsWith(prefix))
      : null;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = settleTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    if (keys) keys.forEach((key) => store.delete(key));
    else store.clear();
    await done;
  } catch (error) {
    console.warn("Could not clear this device's page copies.", error);
  }
}
