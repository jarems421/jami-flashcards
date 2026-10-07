"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import AppPage from "@/components/layout/AppPage";
import DeckObjectCard from "@/components/workspace/DeckObjectCard";
import FolderEditor from "@/components/workspace/FolderEditor";
import {
  FolderLoadingState,
  FolderNotFoundState,
  FoldersDisabledState,
  FolderUnavailableState,
} from "@/components/workspace/FolderLoadStates";
import FolderNotebookCreator from "@/components/workspace/FolderNotebookCreator";
import FolderNotebooksSection from "@/components/workspace/FolderNotebooksSection";
import FolderOverview from "@/components/workspace/FolderOverview";
import FolderShelfSection from "@/components/workspace/FolderShelfSection";
import FolderTabBar from "@/components/workspace/FolderTabBar";
import NotebookEditorDialog from "@/components/workspace/NotebookEditorDialog";
import { Button, ButtonLink, ConfirmDialog, FeedbackBanner, SectionHeader } from "@/components/ui";
import ExamPracticeHistory from "@/components/practice/ExamPracticeHistory";
import { useUser } from "@/components/providers/UserProvider";
import { DECK_SHELF, SOURCE_SHELF, useFolderAssetShelf } from "@/hooks/useFolderAssetShelf";
import { useFolderTab } from "@/hooks/useFolderTab";
import { useFolderWorkspace } from "@/hooks/useFolderWorkspace";
import { useFeedback } from "@/hooks/useFeedback";
import { featureFlags } from "@/lib/app/feature-flags";
import { getDeckHref } from "@/lib/app/routes";
import type { Notebook } from "@/lib/workspace/notebooks";

/**
 * A study folder: its notebooks, its past-paper practice, and the decks and
 * sources linked to it, one tab each.
 */
export default function FolderDetailPage() {
  const { user } = useUser();
  const uid = user.uid;
  const router = useRouter();
  const params = useParams<{ folderId?: string | string[] }>();
  const folderId = Array.isArray(params.folderId) ? params.folderId[0] : params.folderId;
  const { feedback, success, showError, showThrownError, clear: clearFeedback } = useFeedback();
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [showEditFolder, setShowEditFolder] = useState(false);

  const { activeTab, selectTab } = useFolderTab();
  const workspace = useFolderWorkspace({
    uid,
    folderId,
    feedback: { clear: clearFeedback, success, showError, showThrownError },
  });
  const { folder, notebookPendingDelete, setNotebooks } = workspace;
  const shelfFeedback = { success, showError, showThrownError };
  const decks = useFolderAssetShelf({
    kind: DECK_SHELF,
    uid,
    folderId,
    folder,
    active: activeTab === "decks",
    feedback: shelfFeedback,
  });
  const sources = useFolderAssetShelf({
    kind: SOURCE_SHELF,
    uid,
    folderId,
    folder,
    active: activeTab === "sources",
    feedback: shelfFeedback,
  });

  const banner = feedback ? (
    <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => clearFeedback()} />
  ) : null;

  if (!featureFlags.enableFolders) return <FoldersDisabledState />;
  if (workspace.loading) return <FolderLoadingState />;
  if (!folder && workspace.loadState === "not-found") return <FolderNotFoundState />;
  if (!folder) {
    return workspace.loadState === "unavailable" ? (
      <FolderUnavailableState
        banner={banner}
        description="We could not load this folder right now. Your workspace has not been treated as empty."
        onRetry={() => void workspace.reload()}
      />
    ) : (
      <FolderUnavailableState
        description="We could not finish opening this folder. Try again in a moment."
        onRetry={() => void workspace.reload()}
      />
    );
  }

  const isPaper = notebookPendingDelete?.type === "practice_paper";

  return (
    <AppPage title={folder.name} backHref="/dashboard/folders" backLabel="Folders" width="3xl">
      <div className="space-y-6">
        {banner}

        <ConfirmDialog
          open={notebookPendingDelete !== null}
          title={`Delete ${notebookPendingDelete?.title ?? "this notebook"}?`}
          description={
            isPaper
              ? "This permanently deletes the paper, its attempts, saved pages, marking data, and attached files. This cannot be undone."
              : "This removes the notebook from your workspace. Its saved pages are retained so it can be recovered later."
          }
          confirmLabel={isPaper ? "Delete paper permanently" : "Delete notebook"}
          busy={
            notebookPendingDelete !== null &&
            workspace.deletingNotebookId === notebookPendingDelete.id
          }
          onConfirm={() => void workspace.deletePendingNotebook()}
          onClose={() => workspace.setNotebookPendingDelete(null)}
        />

        {editingNotebook ? (
          <NotebookEditorDialog
            userId={uid}
            notebook={editingNotebook}
            topics={workspace.topics}
            onTopicsChange={workspace.setTopics}
            onClose={() => setEditingNotebook(null)}
            onSaved={(updatedNotebook) => {
              setNotebooks((current) =>
                current.map((item) => (item.id === updatedNotebook.id ? updatedNotebook : item))
              );
              setEditingNotebook(null);
              success("Notebook updated.");
            }}
            onArchived={(notebookId) => {
              const archivedTitle = editingNotebook.title;
              setNotebooks((current) => current.filter((item) => item.id !== notebookId));
              setEditingNotebook(null);
              success(`${archivedTitle} archived.`);
            }}
          />
        ) : null}

        <FolderOverview folder={folder} onEdit={() => setShowEditFolder(true)} />

        {showNotebookForm ? (
          <FolderNotebookCreator
            userId={uid}
            folder={folder}
            topics={workspace.topics}
            onTopicsChange={workspace.setTopics}
            onCreated={(notebook, message) => {
              setNotebooks((current) => [notebook, ...current]);
              setShowNotebookForm(false);
              success(message);
            }}
            onCancel={() => setShowNotebookForm(false)}
            onError={showThrownError}
          />
        ) : null}

        {showEditFolder ? (
          <FolderEditor
            userId={uid}
            folder={folder}
            onSaved={(updatedFolder) => {
              workspace.setFolder(updatedFolder);
              setShowEditFolder(false);
              success("Folder updated.");
            }}
            onArchived={() => {
              success("Folder archived. Decks and sources were not deleted.");
              setShowEditFolder(false);
              router.push("/dashboard/folders");
            }}
            onCancel={() => setShowEditFolder(false)}
            onError={showThrownError}
          />
        ) : null}

        <FolderTabBar activeTab={activeTab} onSelect={selectTab} />

        {activeTab === "notebooks" ? (
          <FolderNotebooksSection
            folder={folder}
            notebooks={workspace.notebooks}
            availability={workspace.notebooksAvailability}
            retrying={workspace.retryingNotebooks}
            onRetry={() => void workspace.retryNotebooks()}
            hasMore={workspace.hasMoreNotebooks}
            loadingMore={workspace.loadingMoreNotebooks}
            onLoadMore={() => void workspace.loadMoreNotebooks()}
            deletingNotebookId={workspace.deletingNotebookId}
            onCreate={() => setShowNotebookForm(true)}
            onEdit={setEditingNotebook}
            onDelete={workspace.setNotebookPendingDelete}
          />
        ) : null}

        {activeTab === "practice" && featureFlags.enablePastPaperPractice ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader title="Past papers" />
              <ButtonLink
                href={`/dashboard/practice/questions/new?folderId=${encodeURIComponent(folder.id)}`}
                size="sm"
              >
                Start
              </ButtonLink>
            </div>
            <ExamPracticeHistory folderId={folder.id} embedded />
          </section>
        ) : null}

        {activeTab === "decks" ? (
          <FolderShelfSection
            title="Decks"
            pickerKind="deck"
            addLabel="Add existing deck"
            shelf={decks}
            pickerLabel={(deck) => deck.name}
            gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            emptyTitle="No decks in this folder yet"
            emptyDescription="Add an existing deck."
            loadMoreLabel="Load more decks"
            renderItem={(deck) => (
              <DeckObjectCard
                key={deck.id}
                href={getDeckHref(deck.id)}
                title={deck.name}
                colorPreset={deck.colorPreset}
                iconPreset={deck.iconPreset}
                removing={decks.isBusy(deck)}
                onRemoveFromFolder={() => void decks.toggleLink(deck)}
              />
            )}
          />
        ) : null}

        {activeTab === "sources" ? (
          <FolderShelfSection
            title="Sources"
            pickerKind="source"
            addLabel="Add existing source"
            actions={
              <ButtonLink href={`/dashboard/library?create=1&folderId=${encodeURIComponent(folder.id)}`}>
                Create in Sources
              </ButtonLink>
            }
            shelf={sources}
            pickerLabel={(source) => source.title}
            gridClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
            emptyTitle="No sources in this folder yet"
            emptyDescription="Add or create a source."
            loadMoreLabel="Load more sources"
            renderItem={(source) => (
              <div
                key={source.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text-primary">{source.title}</div>
                    <div className="mt-1 text-xs text-text-muted">{source.type.replace("_", " ")}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={sources.isBusy(source)}
                    onClick={() => void sources.toggleLink(source)}
                  >
                    Remove from folder
                  </Button>
                </div>
              </div>
            )}
          />
        ) : null}
      </div>
    </AppPage>
  );
}
