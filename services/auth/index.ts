import { auth } from "../firebase/client";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AccountDeletionErrorCode,
  type AccountDeletionPhase,
} from "@/lib/auth/account-deletion-contract";

const provider = new GoogleAuthProvider();
const AUTH_OPERATION_TIMEOUT_MS = 30_000;

export function shouldFallbackToGoogleRedirect(code: string | undefined) {
  return (
    code === "auth/popup-blocked" ||
    code === "auth/operation-not-supported-in-this-environment"
  );
}

function withAuthTimeout<T>(operation: Promise<T>, timeoutMs = AUTH_OPERATION_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(Object.assign(new Error("Sign-in timed out."), {
        code: "auth/timeout",
      }));
    }, timeoutMs);

    operation.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function isStandaloneAppWindow() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

export function createRetryableInitializer(initialize: () => Promise<void>) {
  let initializationPromise: Promise<void> | null = null;

  return async () => {
    if (!initializationPromise) {
      initializationPromise = initialize();
    }

    try {
      await initializationPromise;
    } catch (error) {
      // Allow retries after transient/local-storage failures.
      initializationPromise = null;
      throw error;
    }
  };
}

const ensureAuthInitialized = createRetryableInitializer(() =>
  setPersistence(auth, browserLocalPersistence)
);

// Ensure session persists
export const initAuth = async () => {
  await ensureAuthInitialized();
};

// Google sign-in — use the popup flow everywhere. Redirect auth relies on
// cross-origin helper storage unless it is proxied through the app's origin,
// which is not available in the installed PWA.
export const signInWithGoogle = async () => {
  await initAuth();
  const standalone = isStandaloneAppWindow();
  try {
    const result = await withAuthTimeout(signInWithPopup(auth, provider));
    return result.user;
  } catch (popupError: unknown) {
    const code = (popupError as { code?: string }).code;
    // Redirect only when the browser cannot open a popup. User cancellation
    // should return control to the current page instead of starting a redirect.
    if (!standalone && shouldFallbackToGoogleRedirect(code)) {
      await signInWithRedirect(auth, provider);
      return null; // page will reload via redirect
    }
    throw popupError;
  }
};

// Handle redirect result on page load
export const handleGoogleRedirectResult = async () => {
  await initAuth();
  const result = await getRedirectResult(auth);
  return result?.user ?? null;
};

// Logout
export const logout = async () => {
  await signOut(auth);
};

// Email sign-up
export const signUpWithEmail = async (email: string, password: string) => {
  await initAuth();
  const result = await withAuthTimeout(
    createUserWithEmailAndPassword(auth, email, password)
  );
  return result.user;
};

// Email sign-in
export const signInWithEmail = async (email: string, password: string) => {
  await initAuth();
  const result = await withAuthTimeout(
    signInWithEmailAndPassword(auth, email, password)
  );
  return result.user;
};

export const sendPasswordReset = async (email: string) => {
  await initAuth();
  await withAuthTimeout(sendPasswordResetEmail(auth, email.trim()));
};

export class AccountDeletionError extends Error {
  code: AccountDeletionErrorCode;

  constructor(code: AccountDeletionErrorCode, message: string) {
    super(message);
    this.name = "AccountDeletionError";
    this.code = code;
  }
}

export function getAccountDeletionErrorCode(error: unknown) {
  return error instanceof AccountDeletionError ? error.code : undefined;
}

export async function reauthenticateForAccountDeletion(password?: string) {
  await initAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new AccountDeletionError(
      "auth/unauthorized",
      "Sign in again before deleting your account."
    );
  }

  const providerIds = new Set(
    user.providerData.map((providerData) => providerData.providerId)
  );

  if (providerIds.has("google.com")) {
    await withAuthTimeout(reauthenticateWithPopup(user, provider));
    return;
  }

  if (providerIds.has("password")) {
    if (!user.email || !password) {
      throw new AccountDeletionError(
        "account/password-required",
        "Enter your current password to continue."
      );
    }
    const credential = EmailAuthProvider.credential(user.email, password);
    await withAuthTimeout(reauthenticateWithCredential(user, credential));
    return;
  }

  throw new AccountDeletionError(
    "account/unsupported-provider",
    "Sign out, sign back in, and then try deleting your account again."
  );
}

export async function deleteAccount(
  onPhaseChange?: (phase: AccountDeletionPhase) => void
) {
  await initAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new AccountDeletionError(
      "auth/unauthorized",
      "Sign in again before deleting your account."
    );
  }

  onPhaseChange?.("authorizing");
  const token = await user.getIdToken(true);
  onPhaseChange?.("deleting");

  const response = await fetch("/api/account/delete", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION }),
  });

  const result = (await response.json().catch(() => null)) as
    | { error?: unknown; code?: unknown }
    | null;

  if (!response.ok) {
    const code =
      result?.code === "auth/requires-recent-login" ||
      result?.code === "auth/unauthorized" ||
      result?.code === "account/deletion-incomplete"
        ? result.code
        : "account/deletion-incomplete";
    const message =
      typeof result?.error === "string" && result.error.trim()
        ? result.error
        : "Jami could not finish deleting your account. Try again.";
    throw new AccountDeletionError(code, message);
  }

  await signOut(auth).catch(() => undefined);
}
