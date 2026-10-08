import { auth } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

const ROUTE_MS = 30_000;

type SignedInStudent = { getIdToken: () => Promise<string> };

/** The signed-in student, if they are the one asked about; anything else reads directly. */
export function signedInStudent(userId: string): SignedInStudent | null {
  try {
    const user = auth.currentUser;
    return user && user.uid === userId ? user : null;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * One of Jami's routes for the student's own data, answered as JSON.
 *
 * These routes exist because a large read through the browser's Firestore
 * connection is slow -- verbose, long-polled and decoded on the device -- so
 * the read is done beside the database and sent as one compressed response.
 * Throws on anything but a JSON object, so the caller can read directly instead.
 */
export async function readOwnDataRoute(student: SignedInStudent, path: string, label: string) {
  const token = await student.getIdToken();
  const response = await withTimeout(
    fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
    ROUTE_MS,
    label
  );
  if (!response.ok) throw new Error(`${label}: the route answered ${response.status}.`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error(`${label}: the route answered in an unexpected shape.`);
  return body;
}
