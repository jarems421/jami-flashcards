export const ACCOUNT_DELETION_CONFIRMATION = "delete-my-account";

export type AccountDeletionPhase = "authorizing" | "deleting";

export type AccountDeletionErrorCode =
  | "account/deletion-incomplete"
  | "account/password-required"
  | "account/unsupported-provider"
  | "auth/requires-recent-login"
  | "auth/unauthorized";
