"use client";

import { FirebaseError } from "firebase/app";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/user-context";
import NotificationSettingsCard from "@/components/NotificationSettingsCard";
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

  const initial = displayName.charAt(0).toUpperCase();

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
    <main
      data-app-surface="true"
      className="min-h-screen px-3 py-2 text-white sm:px-4 sm:py-3 md:px-6 md:py-4"
    >
      <div className="mx-auto max-w-3xl">
        {/* ── Header ── */}
        <div className="mb-3 sm:mb-4">
          <h1 className="text-xl font-bold">Profile</h1>
        </div>

        {/* ── User info ── */}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-warm-border bg-warm-glow p-3 sm:p-4"
          style={{ backgroundImage: "var(--gradient-card)" }}
        >
          {user.photoURL ? (
            <div
              aria-hidden="true"
              className="h-12 w-12 rounded-full bg-cover bg-center"
              style={{ backgroundImage: `url(${user.photoURL})` }}
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-lg font-bold">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-semibold">{displayName}</div>
            {user.email ? (
              <div className="truncate text-sm text-text-muted">
                {user.email}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Sign out ── */}
        <button
          onClick={() => void handleSignOut()}
          className="mb-4 w-full rounded-xl border border-border bg-glass-subtle p-3 text-left text-sm font-semibold transition duration-fast hover:bg-glass-medium hover:shadow-card active:scale-[0.98] sm:p-4"
          style={{ backgroundImage: "var(--gradient-card)" }}
        >
          Sign out
        </button>

        {/* ── Coming soon settings ── */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-border bg-glass-subtle p-3 opacity-50 sm:p-4"
            style={{ backgroundImage: "var(--gradient-card)" }}
          >
            <span className="text-sm">Theme</span>
            <span className="rounded-md bg-glass-medium px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Coming soon
            </span>
          </div>
          <NotificationSettingsCard userId={user.uid} />
        </div>

        {/* ── Danger zone ── */}
        <div className="rounded-xl border border-error-muted bg-error-muted/30 p-3 sm:p-4"
          style={{ backgroundImage: "var(--gradient-card)" }}
        >
          <h2 className="mb-1 text-sm font-bold text-red-300">Danger Zone</h2>
          <p className="mb-3 text-xs text-text-muted">
            Permanently delete your account and all associated data. This
            cannot be undone.
          </p>

          {error ? (
            <p className="mb-2 text-xs text-red-300">{error}</p>
          ) : null}

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-md bg-error px-4 py-2 text-sm font-semibold transition duration-fast hover:bg-red-600 active:scale-[0.97]"
            >
              Delete Account
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={isDeleting}
                onClick={() => void handleDeleteAccount()}
                className="rounded-md bg-error px-4 py-2 text-sm font-semibold transition duration-fast hover:bg-red-600 active:scale-[0.97] disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Yes, delete everything"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md bg-glass-medium px-4 py-2 text-sm transition duration-fast hover:bg-glass-strong active:scale-[0.97]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
