import { getAdminDb } from "@/services/firebase/admin";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Simple Firestore-backed rate limiter.
 * Tracks request counts per user per action within a rolling window.
 * Returns true if the request is allowed, false if rate-limited.
 */
export async function checkRateLimit(
  uid: string,
  action: string,
  maxRequests: number,
): Promise<boolean> {
  const db = getAdminDb();
  const docRef = db.collection("rateLimits").doc(`${uid}:${action}`);
  const now = Date.now();

  const doc = await docRef.get();
  const data = doc.data();

  if (!data || now - (data.windowStart as number) > WINDOW_MS) {
    await docRef.set({ windowStart: now, count: 1 });
    return true;
  }

  if ((data.count as number) >= maxRequests) {
    return false;
  }

  await docRef.update({ count: (data.count as number) + 1 });
  return true;
}
