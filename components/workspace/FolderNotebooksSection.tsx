"use client";

import { ExamQuestionsPill, PracticePaperPill } from "@/components/practice/PaperEntryPills";
import RevisionSessionPill from "@/components/revision/RevisionSessionPill";
import FolderLoadMoreButton from "@/components/workspace/FolderLoadMoreButton";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import { Button, Card, EmptyState, SectionHeader } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { getFolderHref, getRevisionStartHref } from "@/lib/app/routes";
import { formatEditedLabel } from "@/lib/workspace/folder-workspace";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";

/**
 * The folder's notebooks, with the ways to start work in it.
 *
 * When the notebooks could not be read, the section says so and keeps any it
 * already showed, rather than offering to create a first notebook in a folder
 * that may well have several.
 */
export default function FolderNotebooksSection({
  folder,
  notebooks,
  availability,
  retrying,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  deletingNotebookId,
  onCreate,
  onEdit,
  onDelete,
}: {
  folder: StudyFolder;
  notebooks: Notebook[];
  availability: "loading" | "ready" | "unavailable";
  retrying: boolean;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  deletingNotebookId: string | null;
  onCreate: () => void;
  onEdit: (notebook: Notebook) => void;
  onDelete: (notebook: Notebook) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader title="Notebooks" />
        <div className="flex flex-wrap items-center gap-2">
          {featureFlags.enablePastPaperPractice ? (
            <ExamQuestionsPill
              href={`/dashboard/practice/questions/new?folderId=${encodeURIComponent(folder.id)}`}
            />
          ) : null}
          <PracticePaperPill href={`/dashboard/practice/new?folder=${encodeURIComponent(folder.id)}`} />
          {featureFlags.enableRevisionSessions ? (
            <RevisionSessionPill
              href={getRevisionStartHref({
                folderId: folder.id,
                returnHref: getFolderHref(folder.id),
              })}
            />
          ) : null}
          <Button type="button" size="sm" data-tutorial-target="create-notebook" onClick={onCreate}>
            Create notebook
          </Button>
        </div>
      </div>
      {availability === "unavailable" ? (
        <Card padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Notebooks are temporarily unavailable
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              We kept any notebooks already shown and will not treat this section as empty.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={retrying}
            aria-busy={retrying}
            onClick={onRetry}
          >
            {retrying ? "Retrying..." : "Retry notebooks"}
          </Button>
        </Card>
      ) : null}
      {notebooks.length > 0 || availability === "ready" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {notebooks.length > 0 ? (
            notebooks.map((notebook, index) => (
              <div
                key={notebook.id}
                className="h-full"
                data-tutorial-target={index === 0 ? "first-notebook" : undefined}
              >
                <NotebookObjectCard
                  href={`/dashboard/notebooks/${notebook.id}`}
                  title={notebook.title}
                  typeLabel={notebook.type.replace("_", " ")}
                  color={notebook.color}
                  icon={notebook.icon}
                  pageColor={notebook.pageColor}
                  pageStyle={notebook.pageStyle}
                  previewInkSvg={notebook.previewInkSvg}
                  updatedLabel={formatEditedLabel(notebook.updatedAt)}
                  onEdit={() => onEdit(notebook)}
                  onDelete={() => onDelete(notebook)}
                  deleting={deletingNotebookId === notebook.id}
                  compact
                />
              </div>
            ))
          ) : (
            <div className="col-span-full">
              <EmptyState
                emoji="Notebook"
                title="No notebooks yet"
                description="Create a notebook to start working in this folder."
                action={
                  <Button type="button" data-tutorial-target="create-notebook" onClick={onCreate}>
                    Create notebook
                  </Button>
                }
              />
            </div>
          )}
        </div>
      ) : null}
      {hasMore ? (
        <FolderLoadMoreButton label="Load more notebooks" loading={loadingMore} onLoadMore={onLoadMore} />
      ) : null}
    </section>
  );
}
