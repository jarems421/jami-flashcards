import { FirebaseError } from "firebase/app";

export function isFirebasePermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}
