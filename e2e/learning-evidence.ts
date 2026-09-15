import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, getDocs, query, where } from "firebase/firestore";
import { E2E_PROJECT_ID, E2E_USER_EMAIL, E2E_USER_PASSWORD } from "./fixtures";

/**
 * Reading the Learning Engine's stored evidence back out of the emulator.
 *
 * The browser proves a review was graded; only Firestore can prove what was
 * recorded because of it. Read past the rules on purpose: the rules are
 * exercised by the browser's own write, and this is the observer.
 */

async function e2eUserId() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  if (!authHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is missing. Run through npm run test:e2e.");
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-browser-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { localId?: string };
  if (!response.ok || !body.localId) throw new Error(`Could not resolve the e2e user (${response.status}).`);
  return body.localId;
}

/*
 * Resolved once per worker. Tests poll `readReviewEvents` until an event
 * appears, and neither the user nor the emulator connection changes between
 * polls, so signing in and connecting on every poll was only load. A failure
 * is forgotten, so the next poll tries again.
 */
let userIdPromise: Promise<string> | undefined;
let environmentPromise: ReturnType<typeof initializeTestEnvironment> | undefined;

function forgetOnFailure<T>(promise: Promise<T>, forget: () => void) {
  promise.catch(forget);
  return promise;
}

/** Every stored review event for one card. */
export async function readReviewEvents(cardId: string) {
  userIdPromise ??= forgetOnFailure(e2eUserId(), () => {
    userIdPromise = undefined;
  });
  environmentPromise ??= forgetOnFailure(initializeTestEnvironment({ projectId: E2E_PROJECT_ID }), () => {
    environmentPromise = undefined;
  });
  const [userId, environment] = await Promise.all([userIdPromise, environmentPromise]);

  let events: { id: string; data: Record<string, unknown> }[] = [];
  await environment.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDocs(
      query(
        collection(context.firestore(), "users", userId, "flashcardReviewEvents"),
        where("cardId", "==", cardId)
      )
    );
    events = snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, data: eventDoc.data() }));
  });
  return events;
}
