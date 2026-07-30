import { FirebaseError } from "firebase/app";
import { describe, expect, it } from "vitest";
import {
  getFirebaseErrorCode,
  isFirebasePermissionDenied,
} from "@/services/firebase/errors";

describe("Firebase error helpers", () => {
  it("returns Firebase error codes without exposing Firebase to callers", () => {
    expect(
      getFirebaseErrorCode(
        new FirebaseError("permission-denied", "Permission denied")
      )
    ).toBe("permission-denied");
    expect(getFirebaseErrorCode(new Error("ordinary failure"))).toBeUndefined();
  });

  it("identifies permission-denied errors", () => {
    expect(
      isFirebasePermissionDenied(
        new FirebaseError("permission-denied", "Permission denied")
      )
    ).toBe(true);
    expect(
      isFirebasePermissionDenied(
        new FirebaseError("unavailable", "Service unavailable")
      )
    ).toBe(false);
  });
});
