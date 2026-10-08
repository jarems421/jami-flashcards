"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import AppPage from "@/components/layout/AppPage";
import { Button, EmptyState, Skeleton } from "@/components/ui";

function FolderShell({ children }: { children: ReactNode }) {
  return (
    <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
      {children}
    </AppPage>
  );
}

export function FoldersDisabledState() {
  return (
    <FolderShell>
      <EmptyState
        emoji="Soon"
        title="Folders are not enabled yet"
        description="The folder workspace is behind a feature flag in this environment."
      />
    </FolderShell>
  );
}

export function FolderLoadingState() {
  return (
    <FolderShell>
      <div className="space-y-5">
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    </FolderShell>
  );
}

export function FolderNotFoundState() {
  return (
    <FolderShell>
      <EmptyState
        emoji="Folder"
        title="Folder not found"
        description="This folder may have been archived or removed."
        action={
          <Link
            href="/dashboard/folders"
            className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-button-primary"
          >
            Back to folders
          </Link>
        }
      />
    </FolderShell>
  );
}

/**
 * The folder could not be read. Said as a failure, with a way to try again,
 * so a folder that is merely unreachable is never shown as an empty one.
 */
export function FolderUnavailableState({
  description,
  banner,
  onRetry,
}: {
  description: string;
  banner?: ReactNode;
  onRetry: () => void;
}) {
  return (
    <FolderShell>
      <div className="space-y-4">
        {banner}
        <EmptyState
          emoji="Folder"
          title="Folder unavailable"
          description={description}
          action={
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </div>
    </FolderShell>
  );
}
