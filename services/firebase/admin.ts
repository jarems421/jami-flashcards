import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getRequiredAdminEnv() {
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.trim()?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin environment variables. Configure FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY."
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  /*
   * The emulator has no service account and needs none.
   *
   * Two things have to line up before credentials are skipped: a `demo-`
   * project, which Firebase reserves for local use and refuses to serve real
   * traffic for, and both emulator hosts, which nothing but a local emulator
   * run sets. Either one missing and the real credential path below is the
   * only way through.
   *
   * `NODE_ENV` is deliberately not the third condition, though it looks like
   * the obvious one. The browser suite runs a production build on purpose --
   * `next dev` compiles routes on first visit and made the suite fail
   * differently every run -- so `next start` reports production there, and
   * requiring a non-production build meant every Admin-authenticated route in
   * the harness answered 401. That went unnoticed because no browser test had
   * ever called one; the first that did, found it immediately.
   */
  const emulatorProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (
    emulatorProject?.startsWith("demo-") &&
    process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    return initializeApp({ projectId: emulatorProject });
  }

  const { projectId, clientEmail, privateKey } = getRequiredAdminEnv();

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getAdminDb() {
  return getFirestore(getFirebaseAdminApp());
}

export function getAdminStorageBucket() {
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  if (!storageBucket) {
    throw new Error("Missing NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.");
  }
  return getStorage(getFirebaseAdminApp()).bucket(storageBucket);
}
