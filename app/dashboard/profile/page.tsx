"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/providers/UserProvider";
import AppPage from "@/components/layout/AppPage";
import ProfilePhotoEditor from "@/components/profile/ProfilePhotoEditor";
import NotificationSettingsCard from "@/components/notifications/NotificationSettingsCard";
import { Button, Card, Input, SectionHeader } from "@/components/ui";
import {
  deleteAccount,
  getAccountDeletionErrorCode,
  logout,
  reauthenticateForAccountDeletion,
} from "@/services/auth";
import { getAuthErrorCode, getFriendlyAuthError } from "@/lib/auth/errors";
import {
  loadInAppUsername,
  MAX_USERNAME_LENGTH,
  saveInAppUsername,
} from "@/services/profile";
import { ACCOUNT_TITLE, ACCOUNT_VIEWS } from "@/lib/app/account-views";

export default function ProfilePage() {
  const { user } = useUser();
  const router = useRouter();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletionPhase, setDeletionPhase] = useState<
    "reauthenticating" | "authorizing" | "deleting" | null
  >(null);
  const [requiresRecentLogin, setRequiresRecentLogin] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingUsername, setLoadingUsername] = useState(true);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const displayName =
    savedUsername ||
    user.displayName ||
    (user.email ? user.email.split("@")[0] : "User");
  const canReauthenticateWithGoogle = user.providerData.some(
    (provider) => provider.providerId === "google.com",
  );
  const needsPasswordForReauthentication =
    !canReauthenticateWithGoogle &&
    user.providerData.some((provider) => provider.providerId === "password");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoadingUsername(true);
      setUsernameError(null);
      try {
        const username = await loadInAppUsername(user.uid);
        if (!cancelled) {
          setSavedUsername(username);
          setUsernameInput(username ?? "");
        }
      } catch (nextError) {
        console.error("Failed to load the in-app username.", {
          code: getAuthErrorCode(nextError) ?? "unknown",
        });
        if (!cancelled) {
          setUsernameError("Failed to load your saved name.");
        }
      } finally {
        if (!cancelled) {
          setLoadingUsername(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const handleSignOut = async () => {
    await logout();
    router.push("/");
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteAccount((phase) => setDeletionPhase(phase));
      router.replace("/");
    } catch (nextError) {
      console.error("Account deletion failed.", {
        code: getAccountDeletionErrorCode(nextError) ?? "unknown",
      });
      if (
        getAccountDeletionErrorCode(nextError) === "auth/requires-recent-login"
      ) {
        setRequiresRecentLogin(true);
        setError(
          "For security, verify your sign-in again before Jami removes the account.",
        );
      } else {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Jami could not finish deleting your account. Your sign-in was kept so you can retry.",
        );
      }
    } finally {
      setIsDeleting(false);
      setDeletionPhase(null);
    }
  };

  const handleReauthenticateAndDelete = async () => {
    setIsDeleting(true);
    setDeletionPhase("reauthenticating");
    setError(null);
    try {
      await reauthenticateForAccountDeletion(deletePassword);
      setDeletePassword("");
      setRequiresRecentLogin(false);
      setIsDeleting(false);
      setDeletionPhase(null);
      await handleDeleteAccount();
    } catch (nextError) {
      const accountCode = getAccountDeletionErrorCode(nextError);
      console.error("Account reauthentication failed.", {
        code: accountCode || getAuthErrorCode(nextError) || "unknown",
      });
      setError(
        accountCode === "account/password-required"
          ? "Enter your current password to continue."
          : accountCode === "account/unsupported-provider"
            ? "Sign out, sign back in, and then try deleting your account again."
            : getFriendlyAuthError(getAuthErrorCode(nextError)),
      );
      setIsDeleting(false);
      setDeletionPhase(null);
    }
  };

  const handleSaveUsername = async () => {
    setSavingUsername(true);
    setUsernameError(null);
    setUsernameSaved(false);
    try {
      const nextUsername = await saveInAppUsername(user.uid, usernameInput);
      setSavedUsername(nextUsername);
      setUsernameInput(nextUsername ?? "");
      setUsernameSaved(true);
    } catch (nextError) {
      console.error("Failed to save the in-app username.", {
        code: getAuthErrorCode(nextError) ?? "unknown",
      });
      setUsernameError("Failed to save username.");
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <AppPage
      title={ACCOUNT_TITLE}
      views={ACCOUNT_VIEWS}
      viewsLabel="Account views"
      backHref="/dashboard"
      backLabel="Today"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {/*
        One column, ordered by what the settings are about: who you are, what
        Jami is allowed to send you, and finally the controls that end a session
        or an account. How Jami looks, and the walkthrough that shows you
        around, are a tab away in Personalise -- this view used to carry both,
        so a student who came to sign out met six appearance cards first.

        The identity row used to be a tall two-column grid whose left side held
        only the photo, so a short photo column sat beside a much taller field
        column and left a pool of dead space under the bubble. The photo and the
        name it belongs to are now one centred row that ends where the photo
        ends, and the field that was making the other column tall spans the card
        underneath it.
      */}
      <Card id="profile" tone="warm" padding="lg">
        <SectionHeader
          eyebrow="Profile"
          title="How you appear in Jami"
          description="Your photo and display name are separate from the details you use to sign in."
        />

        <div className="mt-6 flex min-w-0 flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:gap-7 sm:text-left">
          <ProfilePhotoEditor
            userId={user.uid}
            displayName={displayName}
            fallbackPhotoURL={user.photoURL}
          />
          <div className="min-w-0">
            <div className="truncate text-2xl font-medium text-text-primary">
              {displayName}
            </div>
            {user.email ? (
              <div className="mt-1.5 truncate text-sm text-text-muted">
                {user.email}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-7 border-t border-[var(--color-border)] pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input
              label="Name in Jami"
              value={usernameInput}
              onChange={(event) => {
                setUsernameInput(event.target.value);
                setUsernameSaved(false);
                if (usernameError) {
                  setUsernameError(null);
                }
              }}
              maxLength={MAX_USERNAME_LENGTH}
              placeholder="How your name appears in Jami"
              disabled={loadingUsername || savingUsername}
              containerClassName="min-w-0 flex-1 sm:max-w-sm"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleSaveUsername()}
              disabled={loadingUsername || savingUsername}
              className="w-full justify-center sm:w-auto"
            >
              {savingUsername ? "Saving..." : "Save name"}
            </Button>
          </div>
          <p className="mt-2.5 text-xs leading-5 text-text-muted">
            Used around the app. Your sign-in details stay the same.
          </p>
          {usernameError ? (
            <p className="mt-1.5 text-xs text-rose-200">{usernameError}</p>
          ) : null}
          {usernameSaved ? (
            <p className="mt-1.5 text-xs text-emerald-200">Name saved.</p>
          ) : null}
        </div>
      </Card>

      <section id="reminders" aria-label="Study reminders">
        <NotificationSettingsCard userId={user.uid} />
      </section>

      <Card id="account-actions" padding="lg">
        <SectionHeader
          eyebrow="Account"
          title="Sign-in and data"
          description="The controls here affect your session or permanently stored account data."
        />

        <div className="app-subtle-panel mt-5 overflow-hidden rounded-xl">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Sign out of Jami
              </h3>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Your study data stays saved for your next visit.
              </p>
            </div>
            <Button
              onClick={() => void handleSignOut()}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Sign out
            </Button>
          </div>

          <div className="border-t border-[var(--color-border)] p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Delete account
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Permanently remove your sign-in and everything stored by Jami.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <Button
                  onClick={() => {
                    setShowDeleteConfirm(true);
                    setRequiresRecentLogin(false);
                    setDeletePassword("");
                    setError(null);
                  }}
                  variant="danger"
                  className="w-full sm:w-auto"
                >
                  Delete account
                </Button>
              ) : null}
            </div>

            {error ? (
              <p className="mt-4 text-sm leading-6 text-rose-200" role="alert">
                {error}
              </p>
            ) : null}

            {showDeleteConfirm ? (
              <div className="mt-4 rounded-xl border border-error-muted bg-error-muted/20 p-4 sm:p-5">
                <p className="text-sm font-semibold text-text-primary">
                  This cannot be undone.
                </p>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  Jami will remove your decks, cards, folders, notebooks and
                  pages, uploaded files, sources, Topics, Tutor history, AI
                  usage records, goals, stars, study history, notification data,
                  profile, and Firebase sign-in.
                </p>

                {requiresRecentLogin ? (
                  <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                    <p className="text-sm font-semibold text-text-primary">
                      Verify it is you
                    </p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      {needsPasswordForReauthentication
                        ? "Enter your current password. Jami will then retry the deletion."
                        : "Continue with your sign-in provider. Jami will then retry the deletion."}
                    </p>
                    {needsPasswordForReauthentication ? (
                      <Input
                        type="password"
                        label="Current password"
                        value={deletePassword}
                        onChange={(event) =>
                          setDeletePassword(event.target.value)
                        }
                        autoComplete="current-password"
                        disabled={isDeleting}
                        containerClassName="mt-3 max-w-md"
                      />
                    ) : null}
                    <Button
                      type="button"
                      disabled={
                        isDeleting ||
                        (needsPasswordForReauthentication && !deletePassword)
                      }
                      onClick={() => void handleReauthenticateAndDelete()}
                      variant="danger"
                      className="mt-3"
                    >
                      {deletionPhase === "reauthenticating"
                        ? "Verifying..."
                        : needsPasswordForReauthentication
                          ? "Verify and delete"
                          : "Verify sign-in and delete"}
                    </Button>
                  </div>
                ) : null}

                {deletionPhase ? (
                  <p
                    className="mt-4 text-sm font-medium text-text-secondary"
                    role="status"
                  >
                    {deletionPhase === "authorizing"
                      ? "Verifying your account..."
                      : deletionPhase === "deleting"
                        ? "Removing your data and uploaded files. Keep this page open..."
                        : "Verifying your sign-in..."}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {!requiresRecentLogin ? (
                    <Button
                      disabled={isDeleting}
                      onClick={() => void handleDeleteAccount()}
                      variant="danger"
                    >
                      {isDeleting ? "Deleting..." : "Yes, delete everything"}
                    </Button>
                  ) : null}
                  <Button
                    disabled={isDeleting}
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setRequiresRecentLogin(false);
                      setDeletePassword("");
                      setError(null);
                    }}
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </AppPage>
  );
}
