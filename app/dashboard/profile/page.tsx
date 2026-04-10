"use client";

import { FirebaseError } from "firebase/app";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import ProfilePhotoEditor from "@/components/profile/ProfilePhotoEditor";
import NotificationSettingsCard from "@/components/notifications/NotificationSettingsCard";
import { Button, Card } from "@/components/ui";
import { logout, deleteAccount } from "@/services/auth";

export default function ProfilePage() {
  const { user } = useUser();
  const router = useRouter();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName =
    user.displayName ||
    (user.email ? user.email.split("@")[0] : "User");

  const handleSignOut = async () => {
    await logout();
    router.push("/");
  };

  const handleDeleteAccount = async () => {
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

  return (
    <AppPage title="Profile" backHref="/dashboard" backLabel="Dashboard" width="xl" contentClassName="space-y-6">
      <Card tone="warm" className="sm:p-6" padding="md">
        <div className="flex flex-col items-center gap-4">
          <ProfilePhotoEditor
            userId={user.uid}
            displayName={displayName}
            fallbackPhotoURL={user.photoURL}
          />
          <div className="min-w-0 text-center">
            <div className="truncate text-xl font-semibold">{displayName}</div>
            {user.email ? (
              <div className="mt-1 truncate text-sm text-text-muted">
                {user.email}
              </div>
            ) : null}
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

      <div className="space-y-4">
        <Card className="flex items-center justify-between opacity-60" padding="md">
            <span className="text-sm">Theme</span>
            <span className="rounded-lg bg-glass-medium px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Coming soon
            </span>
        </Card>
        <NotificationSettingsCard userId={user.uid} />
      </div>

        <Card tone="subtle" className="border-error-muted bg-error-muted/20 sm:p-6" padding="md">
          <h2 className="mb-1 text-sm font-bold text-rose-200">Danger Zone</h2>
          <p className="mb-3 text-xs text-text-muted">
            Permanently delete your account and data.
          </p>

          {error ? (
            <p className="mb-2 text-xs text-rose-200">{error}</p>
          ) : null}

          {!showDeleteConfirm ? (
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="danger"
            >
              Delete Account
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
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

