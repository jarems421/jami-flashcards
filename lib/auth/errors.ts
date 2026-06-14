export function getAuthErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export function getFriendlyAuthError(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support if this seems wrong.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "The email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account already uses that email. Try signing in instead.";
    case "auth/weak-password":
      return "Use a password with at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment, then try again.";
    case "auth/network-request-failed":
      return "Jami could not reach the sign-in service. Check your connection and try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for Jami and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was cancelled. Try again when you're ready.";
    case "auth/timeout":
      return "Google sign-in took too long. Check your connection and try again.";
    case "auth/account-exists-with-different-credential":
      return "That email already uses another sign-in method.";
    default:
      return "Sign-in did not work. Please try again.";
  }
}
