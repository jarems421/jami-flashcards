"use client";

import { useRef } from "react";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardQualityWarnings from "@/components/decks/CardQualityWarnings";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import TopicPicker from "@/components/topics/TopicPicker";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
} from "@/components/ui";
import type { CardDraft } from "@/hooks/useCardEditing";
import { featureFlags } from "@/lib/app/feature-flags";
import type { Topic } from "@/lib/material/topics";
import { getCardQualityWarnings } from "@/lib/study/card-quality";
import {
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  type Card,
} from "@/lib/study/cards";

type CardEditorDialogProps = {
  /** The card being edited. Null closes the dialog. */
  card: Card | null;
  draft: CardDraft;
  userId: string;
  topics: Topic[];
  topicNamesById: Record<string, string>;
  deckName: string;
  duplicateCount?: number;
  saving: boolean;
  /** Validation or write failure for this edit, shown beside the fields. */
  error?: string | null;
  onDraftChange: (patch: Partial<CardDraft>) => void;
  onTopicsChange: (topics: Topic[]) => void;
  onCancel: () => void;
  onSave: () => void;
};

function hasSameTopics(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((topicId, index) => topicId === right[index])
  );
}

/**
 * Editing one card, lifted above the grid it came from.
 *
 * This used to open in place: the row grew a full form, took two columns, and
 * because the grid sizes its rows with `auto-rows-fr` every other card on the
 * page stretched to match it. One click on Edit and the whole page changed
 * shape. A card is a small object, so editing one is a small piece of work --
 * it belongs on top of the page, in the same frame the preview uses, with the
 * rest of the browse state left exactly where the student left it.
 */
export default function CardEditorDialog({
  card,
  draft,
  userId,
  topics,
  topicNamesById,
  deckName,
  duplicateCount,
  saving,
  error,
  onDraftChange,
  onTopicsChange,
  onCancel,
  onSave,
}: CardEditorDialogProps) {
  const frontFieldRef = useRef<HTMLInputElement>(null);
  const dirty = card
    ? draft.front !== card.front ||
      draft.back !== card.back ||
      !hasSameTopics(draft.topicIds, card.topicIds ?? [])
    : false;

  return (
    <Dialog
      open={Boolean(card)}
      initialFocusRef={frontFieldRef}
      // A stray click on the page behind is the accident that costs typing, so
      // once the draft differs from the card only Cancel or Escape closes it.
      closeOnBackdrop={!dirty && !saving}
      closeOnEscape={!saving}
      className="fixed inset-0 grid place-items-center overflow-y-auto p-4"
      onDismiss={() => onCancel()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="relative my-auto w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-e3">
        {card ? (
          <>
            <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-6">
              <div className="min-w-0">
                <DialogTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Edit card
                </DialogTitle>
                <DialogDescription className="mt-2 truncate text-sm text-text-secondary">
                  {deckName}
                </DialogDescription>
              </div>
              <div className="shrink-0">
                <CardDifficultyBadge card={card} compact />
              </div>
            </div>

            <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">
              <CardQualityWarnings
                warnings={getCardQualityWarnings(
                  {
                    front: draft.front,
                    back: draft.back,
                    topicIds: draft.topicIds,
                  },
                  { duplicateCount }
                )}
              />
              {error ? (
                <p
                  role="alert"
                  className="app-danger rounded-xl px-4 py-3 text-sm"
                >
                  {error}
                </p>
              ) : null}
              <Input
                ref={frontFieldRef}
                label="Front"
                value={draft.front}
                onChange={(event) =>
                  onDraftChange({ front: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || saving) return;
                  // The front is one line, so Enter here means "done", the way
                  // it would in any single-field form.
                  event.preventDefault();
                  onSave();
                }}
                maxLength={MAX_FRONT_LENGTH}
                disabled={saving}
              />
              <CardBackEditor
                label="Back"
                value={draft.back}
                onChange={(back) => onDraftChange({ back })}
                maxLength={MAX_BACK_LENGTH}
                rows={6}
                disabled={saving}
                action={
                  featureFlags.enableFlashcardAi ? (
                    <CardBackAutocomplete
                      front={draft.front}
                      currentBack={draft.back}
                      deckId={card.deckId}
                      deckName={deckName}
                      topics={draft.topicIds.flatMap((topicId) => {
                        const name = topicNamesById[topicId];
                        return name ? [name] : [];
                      })}
                      topicIds={draft.topicIds}
                      disabled={saving}
                      onApply={(back) => onDraftChange({ back })}
                    />
                  ) : null
                }
              />
              <TopicPicker
                userId={userId}
                topics={topics}
                selectedTopicIds={draft.topicIds}
                onChange={(topicIds) => onDraftChange({ topicIds })}
                onTopicsChange={onTopicsChange}
                disabled={saving}
              />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={onCancel}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={onSave}
                className="w-full sm:w-auto"
              >
                {saving ? "Saving..." : "Save card"}
              </Button>
            </div>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
