"use client";

import type { Topic } from "@/lib/practice/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { Deck } from "@/services/study/decks";
import type { GeneratedContentDraft } from "@/services/study/generated-content";
import type { SourceDraftKind } from "@/services/ai/source-drafts";
import { FeedbackBanner } from "@/components/ui";
import SourceDraftEditor from "./SourceDraftEditor";
import SourceCreatePanel, { type SourceMadeCounts } from "./SourceCreatePanel";
import { SourceWorkspaceDrawer } from "./SourceWorkspace";
import type { SourceWorkspaceFeedback } from "./source-workspace-types";

type SourceDraftsDrawerProps = {
  open: boolean;
  drafts: GeneratedContentDraft[];
  made: SourceMadeCounts;
  drafting: SourceDraftKind | null;
  conversationFocusAvailable: boolean;
  useConversationFocus: boolean;
  onUseConversationFocusChange: (value: boolean) => void;
  onGenerate: (kind: SourceDraftKind, count: number) => void;
  selectedDraft: GeneratedContentDraft | null;
  sourceTitle: string | null;
  topics: Topic[];
  decks: Deck[];
  notebooks: Notebook[];
  deckIdByDraft: Record<string, string>;
  notebookIdByDraft: Record<string, string>;
  userId: string;
  feedback: SourceWorkspaceFeedback | null;
  onClose: () => void;
  onDismissFeedback: () => void;
  onSelectDraft: (draftId: string) => void;
  onDeckChange: (draftId: string, deckId: string) => void;
  onNotebookChange: (draftId: string, notebookId: string) => void;
  onSaved: (message: string) => void;
  onTopicsChange: (topics: Topic[]) => void;
};

export default function SourceDraftsDrawer({
  open,
  drafts,
  made,
  drafting,
  conversationFocusAvailable,
  useConversationFocus,
  onUseConversationFocusChange,
  onGenerate,
  selectedDraft,
  sourceTitle,
  topics,
  decks,
  notebooks,
  deckIdByDraft,
  notebookIdByDraft,
  userId,
  feedback,
  onClose,
  onDismissFeedback,
  onSelectDraft,
  onDeckChange,
  onNotebookChange,
  onSaved,
  onTopicsChange,
}: SourceDraftsDrawerProps) {
  return (
    <SourceWorkspaceDrawer
      // Opens whether or not drafts exist: this is where making them happens,
      // not just where finished ones are reviewed.
      open={open}
      eyebrow="Study material"
      title={sourceTitle ? `Create from ${sourceTitle}` : "Create from this source"}
      wide
      onClose={onClose}
    >
      <div className="space-y-5">
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            autoDismissMs={0}
            onDismiss={onDismissFeedback}
          />
        ) : null}

        <SourceCreatePanel
          made={made}
          drafting={drafting}
          conversationFocusAvailable={conversationFocusAvailable}
          useConversationFocus={useConversationFocus}
          onUseConversationFocusChange={onUseConversationFocusChange}
          onGenerate={onGenerate}
        />

        {drafts.length === 0 ? (
          <p className="rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-sm leading-6 text-text-muted">
            Nothing is waiting for review. Anything you make above lands here
            first, so you can edit it before it reaches Learn or a notebook.
          </p>
        ) : null}

        {drafts.length > 0 ? (
          <div className="text-sm font-semibold text-text-primary">
            Awaiting review ({drafts.length})
          </div>
        ) : null}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {drafts.map((draft, index) => {
            const active = selectedDraft?.id === draft.id;
            return (
              <button
                key={draft.id}
                type="button"
                onClick={() => onSelectDraft(draft.id)}
                className={
                  "min-w-[13rem] rounded-[1rem] border p-3 text-left transition " +
                  (active
                    ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-text-primary"
                    : "border-[var(--color-border)] text-text-secondary hover:bg-[var(--color-glass-subtle)]")
                }
              >
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Draft {index + 1}
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-semibold text-text-primary">
                  {draft.kind === "flashcard"
                    ? draft.front ?? "Flashcard draft"
                    : draft.questionText ?? "Notebook question draft"}
                </div>
                <div className="mt-2 text-xs text-text-muted">
                  {draft.kind === "flashcard" ? "Flashcard" : "Notebook page"}
                </div>
              </button>
            );
          })}
        </div>

        {selectedDraft && sourceTitle !== null ? (
          <SourceDraftEditor
            key={selectedDraft.id}
            draft={selectedDraft}
            topics={topics}
            decks={decks}
            notebooks={notebooks}
            selectedDeckId={deckIdByDraft[selectedDraft.id] ?? decks[0]?.id ?? ""}
            selectedNotebookId={
              notebookIdByDraft[selectedDraft.id] ?? notebooks[0]?.id ?? ""
            }
            onDeckChange={(value) => onDeckChange(selectedDraft.id, value)}
            onNotebookChange={(value) =>
              onNotebookChange(selectedDraft.id, value)
            }
            onSaved={onSaved}
            onTopicsChange={onTopicsChange}
            userId={userId}
            sourceTitle={sourceTitle}
          />
        ) : null}
      </div>
    </SourceWorkspaceDrawer>
  );
}
