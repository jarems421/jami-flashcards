"use client";

/**
 * Account migrations this browser has already seen finished.
 *
 * Each one used to be checked against the server on every load, before
 * anything else could start: the topic migration held every dashboard page
 * behind a spinner for a read of the user document, and Today read a study
 * state document before its own reads could begin. For an account that
 * migrated months ago both answers are always the same, and each cost a round
 * trip the student sat through on every visit.
 *
 * A migration's version only ever rises, and the server's record of it is
 * written once, so a version this browser saw finished stays finished. A
 * browser that has never seen it -- a new device, cleared storage, a private
 * window -- asks the server exactly as before.
 */
const STORAGE_PREFIX = "jami:settled-migration:";

function storageKey(userId: string, migration: string) {
  return `${STORAGE_PREFIX}${migration}:${userId}`;
}

export function migrationKnownSettled(userId: string, migration: string, version: number) {
  if (typeof window === "undefined") return false;
  try {
    const stored = Number(localStorage.getItem(storageKey(userId, migration)));
    return Number.isFinite(stored) && stored >= version;
  } catch {
    // Unavailable storage means asking the server, which is always correct.
    return false;
  }
}

export function rememberMigrationSettled(userId: string, migration: string, version: number) {
  try {
    localStorage.setItem(storageKey(userId, migration), String(version));
  } catch {
    // Only a shortcut; the server check still runs next time.
  }
}
