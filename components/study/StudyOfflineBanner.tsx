"use client";

import { Button } from "@/components/ui";

/**
 * Says when Learn is working from the device rather than the server.
 *
 * Shown while offline, or while answers have sat in the device queue past the
 * point where a send should have finished; ordinary saving never shows it.
 */
export default function StudyOfflineBanner({
  offline,
  pendingReviews,
  snapshotSavedAt,
  onSync,
}: {
  offline: boolean;
  pendingReviews: number;
  snapshotSavedAt: number | null;
  onSync: () => void;
}) {
  if (!offline && pendingReviews === 0) return null;

  return (
    <div className="rounded-xl border border-warm-border bg-warm-glow p-4 text-sm text-text-secondary">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold text-text-primary">
            {offline ? "Offline study is active" : "Offline answers are waiting to sync"}
          </div>
          <p className="mt-1 leading-6">
            {pendingReviews > 0
              ? `${pendingReviews} review${pendingReviews === 1 ? "" : "s"} will sync when the browser is online.`
              : snapshotSavedAt
                ? `Using a study snapshot saved ${new Date(snapshotSavedAt).toLocaleString()}.`
                : "Cards are cached locally when a study queue loads."}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pendingReviews === 0 || offline}
          onClick={onSync}
        >
          Sync now
        </Button>
      </div>
    </div>
  );
}
