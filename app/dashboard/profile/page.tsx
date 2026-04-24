"use client";

import { FirebaseError } from "firebase/app";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import ProfilePhotoEditor from "@/components/profile/ProfilePhotoEditor";
import NotificationSettingsCard from "@/components/notifications/NotificationSettingsCard";
import { Button, Card, Input, SectionHeader } from "@/components/ui";
import { logout, deleteAccount } from "@/services/auth";
import {
  loadInAppUsername,
  MAX_USERNAME_LENGTH,
  saveInAppUsername,
} from "@/services/profile";

export default function ProfilePage() {
  const { user, isDemoUser } = useUser();
  const router = useRouter();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
    if (isDemoUser) {
      setError("The shared demo account cannot be deleted.");
      return;
    }

    setIsDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      router.push("/");
    } catch (e) {
      console.error(e);
      const message =
        e instanceof FirebaseError && e.code === "auth/requires-recent-login"
          ? "Please sign in again before deleting your account."
          : e instanceof Error
            ? e.message
            : "Failed to delete account.";
      setError(message);
      setIsDeleting(false);
    }
  };

  const handleSaveUsername = async () => {
    if (isDemoUser) {
      setUsernameError("Name changes are disabled in the shared demo.");
      return;
    }

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
          {isDemoUser ? (
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-warm-accent to-accent text-3xl font-bold text-surface-base shadow-[var(--shadow-accent)]">
              {displayName.charAt(0).toUpperCase()}
            </div>
          ) : (
            <ProfilePhotoEditor
              userId={user.uid}
              displayName={displayName}
              fallbackPhotoURL={user.photoURL}
            />
          )}
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
            {isDemoUser ? (
              <p className="text-xs text-text-muted">
                Shared demo mode keeps profile editing and notifications locked.
              </p>
            ) : null}
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
              disabled={isDemoUser || loadingUsername || savingUsername}
              className="w-full justify-center sm:w-auto"
            >
              {savingUsername ? "Saving..." : "Save name"}
            </Button>
          </div>
        </div>
      </Card>

      <Button
        onClick={() => void handleSignOut()}
        variant="surface"
        size="lg"
        className="w-full justify-start"
      >
        Sign out
      </Button>

      {isDemoUser ? (
        <Card padding="md" className="sm:p-6">
          <SectionHeader
            title="Notifications stay off in the shared demo"
            description="The shared demo cannot subscribe devices or change notification preferences."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <NotificationSettingsCard userId={user.uid} />
        </div>
      )}

      <Card tone="subtle" className="border-error-muted bg-error-muted/20 sm:p-6" padding="md">
        <SectionHeader
          title={<span className="text-rose-200">Danger zone</span>}
          description="Permanently delete your account and data."
        />

        {error ? (
          <p className="mt-3 text-xs text-rose-200">{error}</p>
        ) : null}

        {!showDeleteConfirm ? (
          <Button
            onClick={() => setShowDeleteConfirm(true)}
            variant="danger"
            disabled={isDemoUser}
            className="mt-4"
          >
            Delete Account
          </Button>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={isDeleting}
              onClick={() => void handleDeleteAccount()}
              variant="danger"
            >
              {isDeleting ? "Deleting..." : "Yes, delete everything"}
            </Button>
            <Button
              onClick={() => setShowDeleteConfirm(false)}
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </AppPage>
  );
}
