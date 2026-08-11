/**
 * The one-time links Firebase mails out, handled inside Jami.
 *
 * Firebase hosts a page for these by default, and for password resets that page
 * is a hole in the policy: it enforces Firebase's own six-character floor and
 * nothing else, so a password refused at sign-up can be set through the emailed
 * link a minute later. The only way to close that is to handle the link here,
 * where the same rule applies to both.
 *
 * Handling one mode means handling all of them, because the Firebase Console
 * points every template at a single action URL. So verify-email and the
 * recover-email safety net come along, and an unknown mode has to fail politely
 * rather than show a blank page.
 */

export type AuthActionMode =
  | "resetPassword"
  | "verifyEmail"
  | "recoverEmail"
  | "unknown";

export type AuthActionRequest = {
  mode: AuthActionMode;
  code: string | null;
};

const KNOWN_MODES: AuthActionMode[] = [
  "resetPassword",
  "verifyEmail",
  "recoverEmail",
];

/**
 * Reads the mode and code Firebase puts in the link.
 *
 * `oobCode` is the out-of-band code; it is the only thing proving the link came
 * from the mail, so a link without one is not actionable whatever its mode
 * says.
 */
export function parseAuthActionRequest(
  params: Pick<URLSearchParams, "get">
): AuthActionRequest {
  const rawMode = params.get("mode");
  const mode = KNOWN_MODES.find((known) => known === rawMode) ?? "unknown";
  const code = params.get("oobCode")?.trim() || null;
  return { mode, code };
}

export type AuthActionCopy = {
  title: string;
  description: string;
};

export function getAuthActionCopy(mode: AuthActionMode): AuthActionCopy {
  switch (mode) {
    case "resetPassword":
      return {
        title: "Choose a new password",
        description:
          "This link came from your email, so there is nothing else to prove. Pick a password and you are back in.",
      };
    case "verifyEmail":
      return {
        title: "Confirming your email",
        description: "One moment while this link is checked.",
      };
    case "recoverEmail":
      return {
        title: "Restoring your email address",
        description:
          "Your account's email address is being changed back to what it was.",
      };
    case "unknown":
      return {
        title: "That link cannot be used",
        description:
          "It may have been opened already, or been changed on the way. Ask for a new one and it will work.",
      };
  }
}

/**
 * What to say when Firebase turns a code down.
 *
 * Expiry and reuse are the ordinary cases and they are not errors on the
 * reader's part, so they get an instruction rather than an apology.
 */
export function getAuthActionErrorMessage(code: string | undefined): string {
  switch (code) {
    case "auth/expired-action-code":
      return "That link has expired. Ask for a new one and it will work.";
    case "auth/invalid-action-code":
      return "That link has already been used, or was cut short on the way. Ask for a new one.";
    case "auth/user-disabled":
      return "That account has been disabled.";
    case "auth/user-not-found":
      return "That account no longer exists.";
    case "auth/weak-password":
      return "Choose a longer password.";
    default:
      return "That did not work. Ask for a new link and try again.";
  }
}
