"use client";

import {
  normalizeTutorialProgress,
  type TutorialProgress,
} from "@/lib/onboarding/tutorial";

const STORAGE_PREFIX = "jami:tutorial:";

/**
 * The walkthrough's local copy of its own progress.
 *
 * The account is the source of truth, but it is reached over the network, and
 * a student halfway through the walkthrough on a bad connection should not be
 * sent back to mission one because one read failed. Every change is mirrored
 * here first, so a failed load has something honest to fall back to and a
 * failed save is not lost the moment the tab closes.
 *
 * Keyed per user: a shared device must not show one student another's
 * progress.
 */
function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function readLocalTutorialProgress(
  userId: string
): TutorialProgress | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return normalizeTutorialProgress(JSON.parse(raw));
  } catch {
    // Unreadable or unavailable storage is the same as having no copy.
    return null;
  }
}

export function saveLocalTutorialProgress(
  userId: string,
  progress: TutorialProgress
) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(progress));
  } catch {
    // The account copy is what matters; this one is a convenience.
  }
}

/**
 * Which of the two copies to trust.
 *
 * Whichever was written last wins. The account copy is preferred on a tie so
 * that a second device, which has no local copy of a walkthrough finished
 * elsewhere, does not restart it.
 */
export function mergeTutorialProgress(
  local: TutorialProgress | null,
  remote: TutorialProgress | null
): TutorialProgress | null {
  if (!local) return remote;
  if (!remote) return local;
  return local.updatedAt > remote.updatedAt ? local : remote;
}
