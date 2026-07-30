import { FirebaseError } from "firebase/app";

export function getFirebaseErrorCode(error: unknown) {
  return error instanceof FirebaseError ? error.code : undefined;
}

export function isFirebasePermissionDenied(error: unknown) {
  return getFirebaseErrorCode(error) === "permission-denied";
}
