"use client";

import { MAX_SOURCE_FOLDER_IDS, type Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import TopicPicker from "@/components/topics/TopicPicker";
import { FeedbackBanner } from "@/components/ui";
import {
  sourceDisplayLabel,
  SourceWorkspaceDrawer,
} from "./SourceWorkspace";
import type { SourceWorkspaceFeedback } from "./source-workspace-types";

type SourceDetailsDrawerProps = {
  open: boolean;
  source: Source | null;
  folders: StudyFolder[];
  topics: Topic[];
  userId: string;
  feedback: SourceWorkspaceFeedback | null;
  busyAction: string | null;
  onClose: () => void;
  onDismissFeedback: () => void;
  onToggleFolder: (folderId: string) => void;
  onUpdateTopics: (topicIds: string[]) => void;
  onTopicsChange: (topics: Topic[]) => void;
};

export default function SourceDetailsDrawer({
  open,
  source,
  folders,
  topics,
  userId,
  feedback,
  busyAction,
  onClose,
  onDismissFeedback,
  onToggleFolder,
  onUpdateTopics,
  onTopicsChange,
}: SourceDetailsDrawerProps) {
  return (
    <SourceWorkspaceDrawer
      open={open}
      eyebrow="Source details"
      title={source?.title ?? "Source"}
      onClose={onClose}
    >
      {source ? (
        <div className="space-y-7">
          {feedback ? (
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={onDismissFeedback}
            />
          ) : null}

          <section>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Folders
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Place this source in up to {MAX_SOURCE_FOLDER_IDS} study spaces.
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-text-muted">
                {source.folderIds.length}/{MAX_SOURCE_FOLDER_IDS}
              </span>
            </div>
            {folders.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-text-muted">
                No folders yet.
              </p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-[1rem] border border-[var(--color-border)]">
                {folders.map((folder) => {
                  const checked = source.folderIds.includes(folder.id);
                  const limitReached =
                    !checked && source.folderIds.length >= MAX_SOURCE_FOLDER_IDS;
                  return (
                    <label
                      key={folder.id}
                      className={
                        "flex min-h-12 items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm last:border-b-0 " +
                        (limitReached
                          ? "cursor-not-allowed text-text-muted"
                          : "cursor-pointer text-text-primary hover:bg-[var(--color-glass-subtle)]")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={limitReached || busyAction === "source-folders"}
                        onChange={() => onToggleFolder(folder.id)}
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 truncate">{folder.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          <section className="border-t border-[var(--color-border)] pt-6">
            <TopicPicker
              userId={userId}
              topics={topics}
              selectedTopicIds={source.topicIds}
              onChange={onUpdateTopics}
              onTopicsChange={onTopicsChange}
              disabled={busyAction !== null}
            />
          </section>

          <section className="border-t border-[var(--color-border)] pt-6">
            <h3 className="text-sm font-semibold text-text-primary">
              About this source
            </h3>
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
              <dt className="text-text-muted">Type</dt>
              <dd className="text-right text-text-secondary">
                {sourceDisplayLabel(source)}
              </dd>
              <dt className="text-text-muted">Added</dt>
              <dd className="text-right text-text-secondary">
                {source.createdAt > 0
                  ? new Intl.DateTimeFormat("en", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }).format(source.createdAt)
                  : "Previously"}
              </dd>
              <dt className="text-text-muted">Status</dt>
              <dd className="text-right capitalize text-text-secondary">
                {source.status}
              </dd>
              {source.fileName ? (
                <>
                  <dt className="text-text-muted">File</dt>
                  <dd className="break-words text-right text-text-secondary">
                    {source.fileName}
                  </dd>
                </>
              ) : null}
              {typeof source.sizeBytes === "number" ? (
                <>
                  <dt className="text-text-muted">Size</dt>
                  <dd className="text-right text-text-secondary">
                    {Math.round(source.sizeBytes / 1024)} KB
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
        </div>
      ) : null}
    </SourceWorkspaceDrawer>
  );
}
