import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import {
  applyAppearanceToDevice,
  DEFAULT_APPEARANCE,
  normalizeAccountAppearance,
  readAppearanceOwner,
  readDeviceAppearance,
  resolveSignInAppearance,
  type AccountAppearance,
  type AppearanceChoice,
} from "@/lib/app/appearance";

export async function loadAccountAppearance(userId: string) {
  const snapshot = await getDoc(doc(db, "users", userId));
  return snapshot.exists() ? normalizeAccountAppearance(snapshot.data().appearance) : null;
}

async function writeAccountAppearance(userId: string, choice: AppearanceChoice) {
  const appearance: AccountAppearance = { ...choice, updatedAt: Date.now() };
  await setDoc(doc(db, "users", userId), { appearance }, { merge: true });
}

/**
 * Change how Jami looks for this account: painted here at once, then saved so
 * every other device the student signs into opens the same way.
 */
export async function updateAppearance(userId: string, change: Partial<AppearanceChoice>) {
  const next = { ...readDeviceAppearance(), ...change };
  applyAppearanceToDevice(next, userId);
  await writeAccountAppearance(userId, next);
}

/**
 * Bring this device into line with the account that just signed in.
 *
 * A look that belongs to another account is cleared before the account is
 * read, so nobody sits in someone else's colours while their own load.
 */
export async function syncAppearance(userId: string, accountCreatedAt: number) {
  const owner = readAppearanceOwner();
  if (owner && owner !== userId) applyAppearanceToDevice(DEFAULT_APPEARANCE, null);

  const remote = await loadAccountAppearance(userId);
  const resolved = resolveSignInAppearance({
    userId,
    remote,
    device: readDeviceAppearance(),
    /*
     * Who owned the device before it was cleared. Read afterwards it is always
     * nobody, and an older account would then save Jami's default look over
     * the one on its own devices.
     */
    deviceOwner: owner,
    accountCreatedAt,
  });
  applyAppearanceToDevice(resolved.choice, userId);
  if (resolved.save) await writeAccountAppearance(userId, resolved.choice);
}

/** Signing out leaves the device in Jami's own look, owned by nobody. */
export function resetDeviceAppearance() {
  applyAppearanceToDevice(DEFAULT_APPEARANCE, null);
}
