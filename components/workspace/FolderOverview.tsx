"use client";

import Link from "next/link";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { Button } from "@/components/ui";
import type { StudyFolder } from "@/lib/workspace/study-folders";

/** Where the folder sits, what it is, and the way into its settings. */
export default function FolderOverview({
  folder,
  onEdit,
}: {
  folder: StudyFolder;
  onEdit: () => void;
}) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text-muted">
        <Link href="/dashboard/folders" className="font-medium transition hover:text-text-primary">
          Folders
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate text-text-secondary">{folder.name}</span>
      </nav>

      <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="w-[8.35rem] shrink-0">
            <FolderObjectCard title={folder.name} color={folder.color} icon={folder.icon} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Study folder
            </p>
            <h2 className="mt-1 truncate text-2xl font-semibold text-text-primary sm:text-3xl">
              {folder.name}
            </h2>
            {folder.subject ? <p className="mt-1 text-sm text-text-muted">{folder.subject}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button type="button" variant="secondary" onClick={onEdit}>
            Edit folder
          </Button>
        </div>
      </div>
    </>
  );
}
