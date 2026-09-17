/**
 * Holding on to pages of the paper between page turns.
 *
 * Licensed assets are streamed through an authorised route that answers
 * `Cache-Control: private, no-store`, deliberately: a question paper should not
 * sit in a disk cache after the session that was allowed to see it has ended.
 * That is right, and it means the browser will re-request a page every time it
 * is asked for -- so turning from page two back to page one of a question
 * downloaded the paper again and showed a loading placeholder where a student
 * had just been writing.
 *
 * So the decoded blobs are kept for the life of the tab instead, and no longer.
 * Nothing is written to disk and nothing outlives a reload, which is the
 * property the header is protecting; what changes is only that the same page,
 * in the same session, is not fetched twice.
 *
 * Entries are counted rather than timed. A URL is revoked when the last image
 * using it has gone and the cache has run out of room -- never while something
 * is still displaying it, which would blank a page mid-answer.
 */

/** Pages of a long question, plus room to turn back to an earlier one. */
const MAX_IDLE_ENTRIES = 16;

type Entry = {
  url: Promise<string>;
  /** How many mounted images are displaying it. */
  users: number;
  /** Bumped on every use, so the least recently released goes first. */
  touchedAt: number;
};

const entries = new Map<string, Entry>();
let clock = 0;

function releaseIdle() {
  const idle = [...entries.entries()]
    .filter(([, entry]) => entry.users === 0)
    .sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  let excess = entries.size - MAX_IDLE_ENTRIES;
  for (const [path, entry] of idle) {
    if (excess <= 0) break;
    entries.delete(path);
    excess -= 1;
    void entry.url.then(URL.revokeObjectURL).catch(() => undefined);
  }
}

/**
 * The object URL for a path, fetched once.
 *
 * The caller holds it until it calls the returned release, which is what makes
 * it safe to throw away. A failed fetch is never kept: the retry a student is
 * offered has to be able to actually try again.
 */
export function acquireCachedImageUrl(path: string, fetchBlob: () => Promise<Blob>) {
  clock += 1;
  let entry = entries.get(path);
  if (!entry) {
    entry = {
      url: fetchBlob().then((blob) => URL.createObjectURL(blob)),
      users: 0,
      touchedAt: clock,
    };
    entries.set(path, entry);
    void entry.url.catch(() => {
      if (entries.get(path) === entry) entries.delete(path);
    });
  }
  entry.users += 1;
  entry.touchedAt = clock;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const current = entries.get(path);
    if (current !== entry) return;
    clock += 1;
    current.users = Math.max(0, current.users - 1);
    current.touchedAt = clock;
    releaseIdle();
  };
  return { url: entry.url, release };
}

/** For tests, and for a sign-out that should leave nothing behind. */
export function clearCachedImageUrls() {
  for (const entry of entries.values()) {
    void entry.url.then(URL.revokeObjectURL).catch(() => undefined);
  }
  entries.clear();
}
