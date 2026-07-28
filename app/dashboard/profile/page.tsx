"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import ProfilePhotoEditor from "@/components/profile/ProfilePhotoEditor";
import HowJamiWorksCard from "@/components/study/HowJamiWorksCard";
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
import {
  APP_THEME_OPTIONS,
  readAppThemePreference,
  saveAppThemePreference,
  type AppThemePreference,
} from "@/lib/app/theme-preference";

function ThemePreferenceCard() {
  const [selectedTheme, setSelectedTheme] =
    useState<AppThemePreference>(() => readAppThemePreference());

  const handleSelectTheme = (value: AppThemePreference) => {
    setSelectedTheme(value);
    saveAppThemePreference(value);
  };

  return (
    <Card padding="md" className="sm:p-6">
      <SectionHeader
        title="Theme"
        description="Choose the app look on this device. This changes the whole shell, not your study data."
      />
      {/*
        Read as a palette rather than a list of settings: the swatch is the
        content, the name labels it, and the description moves to the button's
        title and accessible name so screen readers keep it without the grid
        turning into a wall of text at six options.
      */}
      <div
        role="radiogroup"
        aria-label="App theme"
        className="mt-5 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6"
      >
        {APP_THEME_OPTIONS.map((option) => {
          const active = selectedTheme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.description}
              aria-label={`${option.label}. ${option.description}`}
              onClick={() => handleSelectTheme(option.value)}
              className="group flex flex-col items-center gap-2 rounded-[1.15rem] p-1.5 outline-none transition duration-fast focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              <span
                className={`relative grid aspect-square w-full max-w-[4.5rem] place-items-center rounded-full border-2 transition duration-fast ${
                  active
                    ? "border-[var(--color-accent)] shadow-[0_0_0_4px_var(--color-accent-muted)]"
                    : "border-[var(--color-border)] group-hover:border-border-strong"
                }`}
                style={{ backgroundImage: option.preview }}
                aria-hidden="true"
              >
                {active ? (
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-5 w-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
                  >
                    <path
                      d="m5 10.5 3.4 3.4L15 7.2"
                      stroke="#ffffff"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
              <span
                className={`text-center text-xs font-semibold leading-4 transition duration-fast ${
                  active ? "text-text-primary" : "text-text-muted group-hover:text-text-primary"
                }`}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

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
    (provider) => provider.providerId === "google.com"
  );
  const needsPasswordForReauthentication =
    !canReauthenticateWithGoogle &&
    user.providerData.some((provider) => provider.providerId === "password");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoadingUsername(true);
      try {
        const username = await loadInAppUsername(user.uid);
        if (!cancelled) {
          setSavedUsername(username);
          setUsernameInput(username ?? "");
        }
      } catch (nextError) {
        console.error(nextError);
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
      console.error(nextError);
      if (
        getAccountDeletionErrorCode(nextError) ===
        "auth/requires-recent-login"
      ) {
        setRequiresRecentLogin(true);
        setError(
          "For security, verify your sign-in again before Jami removes the account."
        );
      } else {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Jami could not finish deleting your account. Your sign-in was kept so you can retry."
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
      console.error(nextError);
      const accountCode = getAccountDeletionErrorCode(nextError);
      setError(
        accountCode === "account/password-required"
          ? "Enter your current password to continue."
          : accountCode === "account/unsupported-provider"
            ? "Sign out, sign back in, and then try deleting your account again."
            : getFriendlyAuthError(getAuthErrorCode(nextError))
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
      console.error(nextError);
      setUsernameError("Failed to save username.");
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <AppPage title="Account" backHref="/dashboard" backLabel="Today" width="xl" contentClassName="space-y-4 sm:space-y-6">
      <Card tone="warm" className="sm:p-6" padding="md">
        <div className="flex flex-col items-center gap-5">
          <ProfilePhotoEditor
            userId={user.uid}
            displayName={displayName}
            fallbackPhotoURL={user.photoURL}
          />
          <div className="min-w-0 text-center">
            <div className="truncate text-xl font-medium">{displayName}</div>
            {user.email ? (
              <div className="mt-1 truncate text-sm text-text-muted">
                {user.email}
              </div>
            ) : null}
          </div>
          <div className="w-full max-w-md space-y-2">
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
            />
            <p className="text-xs text-text-muted">
              This is how your name appears around the app. Your sign-in details stay the same.
            </p>
            {usernameError ? (
              <p className="text-xs text-rose-200">{usernameError}</p>
            ) : null}
            {usernameSaved ? (
              <p className="text-xs text-emerald-200">Name saved.</p>
            ) : null}
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
        </div>
      </Card>

      <Button
        onClick={() => void handleSignOut()}
        variant="secondary"
        size="lg"
        className="w-full justify-start"
      >
        Sign out
      </Button>

      <HowJamiWorksCard />

      <ThemePreferenceCard />

      <div className="space-y-4">
        <NotificationSettingsCard userId={user.uid} />
      </div>

      <Card tone="subtle" className="border-error-muted bg-error-muted/20 sm:p-6" padding="md">
        <SectionHeader
          title={<span className="text-rose-200">Danger zone</span>}
          description="Permanently remove your sign-in and all data stored by Jami."
        />

        {error ? (
          <p className="mt-3 text-sm leading-6 text-rose-200" role="alert">
            {error}
          </p>
        ) : null}

        {!showDeleteConfirm ? (
          <Button
            onClick={() => {
              setShowDeleteConfirm(true);
              setRequiresRecentLogin(false);
              setDeletePassword("");
              setError(null);
            }}
            variant="danger"
            className="mt-4"
          >
            Delete Account
          </Button>
        ) : (
          <div className="app-subtle-panel mt-4 rounded-[1.2rem] p-4">
            <p className="text-sm font-semibold text-text-primary">
              This cannot be undone.
            </p>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Jami will remove your decks, cards, folders, notebooks and pages,
              uploaded files, sources, Topics, Tutor history, AI usage records,
              goals, stars, study history, notification data, profile, and
              Firebase sign-in.
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
                    onChange={(event) => setDeletePassword(event.target.value)}
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
              <p className="mt-4 text-sm font-medium text-text-secondary" role="status">
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
        )}
      </Card>
    </AppPage>
  );
}
