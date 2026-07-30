import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { resolveFirebaseEmulatorConfig } from "@/lib/firebase/emulator-config";

function readEnv(value: string | undefined) {
  return value?.trim() ?? "";
}

const FIREBASE_ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: readEnv(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: readEnv(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: readEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: readEnv(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    readEnv(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  NEXT_PUBLIC_FIREBASE_APP_ID: readEnv(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  NEXT_PUBLIC_FIREBASE_EMULATORS: readEnv(
    process.env.NEXT_PUBLIC_FIREBASE_EMULATORS
  ),
} as const;

const REQUIRED_FIREBASE_ENV_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    !normalized ||
    normalized.includes("your-") ||
    normalized.includes("example") ||
    normalized.includes("placeholder")
  );
}

function getFirebaseEnvIssues() {
  const issues: string[] = [];

  for (const key of REQUIRED_FIREBASE_ENV_KEYS) {
    const value = FIREBASE_ENV[key];

    if (!value) {
      issues.push(`${key} is missing`);
      continue;
    }

    if (isPlaceholderValue(value)) {
      issues.push(`${key} is using a placeholder value`);
    }
  }

  return issues;
}

function getRequiredEnv(name: keyof typeof FIREBASE_ENV): string {
  const value = FIREBASE_ENV[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const firebaseConfig = {
  apiKey: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const firebaseEmulatorConfig = resolveFirebaseEmulatorConfig({
  enabled: FIREBASE_ENV.NEXT_PUBLIC_FIREBASE_EMULATORS,
  projectId: firebaseConfig.projectId,
});

function validateFirebaseConfig() {
  const issues = getFirebaseEnvIssues();

  if (issues.length > 0) {
    throw new Error(`Invalid Firebase environment configuration: ${issues.join("; ")}`);
  }

  for (const key of REQUIRED_FIREBASE_ENV_KEYS) {
    getRequiredEnv(key);
  }
}

function hasAllRequiredFirebaseEnv() {
  return getFirebaseEnvIssues().length === 0;
}

function createUninitializedProxy<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(
        `Firebase ${name} is not initialized. Ensure all NEXT_PUBLIC_FIREBASE_* env vars are set.`
      );
    },
  });
}

const app = hasAllRequiredFirebaseEnv() ? initializeApp(firebaseConfig) : null;

const authInstance = app
  ? getAuth(app)
  : createUninitializedProxy<ReturnType<typeof getAuth>>("auth");

const dbInstance = app
  ? typeof window === "undefined"
    ? getFirestore(app)
    : initializeFirestore(app, {
        // Avoid WebChannel requests being buffered indefinitely by mobile
        // networks, privacy relays, antivirus proxies, or restrictive Wi-Fi.
        experimentalForceLongPolling: true,
      })
  : createUninitializedProxy<ReturnType<typeof getFirestore>>("db");

const storageInstance = app
  ? getStorage(app)
  : createUninitializedProxy<ReturnType<typeof getStorage>>("storage");

type FirebaseEmulatorConnectionState = typeof globalThis & {
  __jamiFirebaseEmulatorProjects?: Set<string>;
};

function connectFirebaseEmulators() {
  if (!app || typeof window === "undefined") return;
  if (!firebaseEmulatorConfig.enabled) return;

  const state = globalThis as FirebaseEmulatorConnectionState;
  const connectedProjects =
    state.__jamiFirebaseEmulatorProjects ??
    (state.__jamiFirebaseEmulatorProjects = new Set<string>());
  if (connectedProjects.has(firebaseConfig.projectId)) return;

  connectAuthEmulator(
    authInstance,
    `http://${firebaseEmulatorConfig.host}:${firebaseEmulatorConfig.authPort}`,
    { disableWarnings: true }
  );
  connectFirestoreEmulator(
    dbInstance,
    firebaseEmulatorConfig.host,
    firebaseEmulatorConfig.firestorePort
  );
  connectStorageEmulator(
    storageInstance,
    firebaseEmulatorConfig.host,
    firebaseEmulatorConfig.storagePort
  );
  connectedProjects.add(firebaseConfig.projectId);
}

connectFirebaseEmulators();

export const auth = authInstance;
export const db = dbInstance;
export const storage = storageInstance;

export { validateFirebaseConfig, getFirebaseEnvIssues };
