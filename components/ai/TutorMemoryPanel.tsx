"use client";

import { useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  FeedbackBanner,
  Input,
  SettingSwitch,
  Skeleton,
} from "@/components/ui";
import type { useTutorMemory } from "@/hooks/useTutorMemory";
import {
  describeTimeAgo,
  MAX_TUTOR_MEMORY_TEXT_LENGTH,
  TUTOR_MEMORY_KIND_LABELS,
  type TutorMemoryKind,
} from "@/lib/ai/tutor-memory";
import type { TutorMemoryEntry } from "@/services/ai/tutor-memory";

/** The order a student reads their memory in: what's live first, what lasts last. */
const KIND_ORDER: readonly TutorMemoryKind[] = ["plan", "struggle", "goal", "preference", "context"];

const KIND_HINTS: Record<TutorMemoryKind, string> = {
  plan: "Picked up in your next chat, then let go after two days.",
  struggle: "Jami offers help with these, and fades them after a month unless they come up again.",
  goal: "What Jami keeps in mind when it suggests what to do next.",
  preference: "Your teaching settings still win if the two disagree.",
  context: "Facts about your course that save you repeating yourself.",
};

function RemoveIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** One memory, read as a line and corrected in place, like a note. */
function MemoryRow({
  item,
  now,
  onEdit,
  onForget,
}: {
  item: TutorMemoryEntry;
  now: number;
  onEdit: (text: string) => void;
  onForget: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const cancelledRef = useRef(false);

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next) onForget();
    else if (next !== item.text) onEdit(next);
  };

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] py-2 pl-3.5 pr-2 transition duration-fast hover:border-[var(--color-border-strong)]">
      <span aria-hidden="true" className="grid h-8 w-5 shrink-0 place-items-center">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            aria-label="Correct this memory"
            ref={(node) => node?.focus()}
            value={draft}
            maxLength={MAX_TUTOR_MEMORY_TEXT_LENGTH}
            className="py-1.5"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                cancelledRef.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <button
            type="button"
            aria-label={`Correct this memory: ${item.text}`}
            className="w-full rounded-lg py-1 text-left text-sm leading-6 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            onClick={() => {
              setDraft(item.text);
              setEditing(true);
            }}
          >
            {item.text}
          </button>
        )}
        <p className="pb-0.5 text-2xs text-text-muted">{describeTimeAgo(item.updatedAt, now)}</p>
      </div>
      <button
        type="button"
        aria-label={`Forget: ${item.text}`}
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        onClick={onForget}
      >
        <RemoveIcon />
      </button>
    </li>
  );
}

type TutorMemoryPanelProps = {
  memory: ReturnType<typeof useTutorMemory>;
  /** `compact` inside the settings drawer, `comfortable` on the full page. */
  density?: "comfortable" | "compact";
};

/**
 * What Jami remembers across chats, and the student's say over it.
 *
 * Everything Tutor carries from one chat to the next is on this list, in the
 * words Tutor will read it in. A student can correct a line by tapping it,
 * forget one, forget all of it, or switch memory off -- which stops it being
 * used or added to straight away.
 */
export default function TutorMemoryPanel({ memory, density = "comfortable" }: TutorMemoryPanelProps) {
  const [confirmingForgetAll, setConfirmingForgetAll] = useState(false);
  // Captured once per render for the "3 days ago" labels; nothing here ticks.
  const [now] = useState(() => Date.now());
  const { view, loading, loadFailed, busy, feedback, clearFeedback, reload } = memory;
  const compact = density === "compact";

  if (loading && !view) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }
  if (loadFailed || !view) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-text-secondary">Jami could not load what it remembers.</p>
        <Button type="button" variant="secondary" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: view.items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={clearFeedback} />
      ) : null}

      <SettingSwitch
        label="Remember across chats"
        description="Jami keeps short notes from your chats — how you like to learn, what you find hard, what you're working on next — so every chat picks up where the last one left off."
        checked={view.enabled}
        density={compact ? "compact" : "comfortable"}
        onChange={(enabled) => void memory.setEnabled(enabled)}
      />

      {!view.enabled ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-3 text-sm leading-6 text-text-muted">
          Memory is off. Jami isn&apos;t using or adding to anything below, and each chat starts fresh.
          {view.items.length > 0 ? " What was saved stays here until you forget it." : ""}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-3 text-sm leading-6 text-text-muted">
          Nothing yet. When something from a chat is worth carrying into the next one, it appears here, and you can change or remove it.
        </p>
      ) : (
        <div className={`flex flex-col ${compact ? "gap-5" : "gap-6"}`}>
          {groups.map((group) => (
            <section key={group.kind} aria-labelledby={`tutor-memory-${group.kind}`} className="flex flex-col gap-2.5">
              <div>
                <h4
                  id={`tutor-memory-${group.kind}`}
                  className="text-xs font-semibold tracking-tight text-text-primary"
                >
                  {TUTOR_MEMORY_KIND_LABELS[group.kind]}
                </h4>
                <p className="mt-0.5 text-2xs leading-4 text-text-muted">{KIND_HINTS[group.kind]}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <MemoryRow
                    key={item.id}
                    item={item}
                    now={now}
                    onEdit={(text) => void memory.edit(item.id, text)}
                    onForget={() => void memory.forget(item.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {view.items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
          <p className="text-2xs text-text-muted">
            {view.items.length} {view.items.length === 1 ? "memory" : "memories"}
            {busy ? " · Saving…" : ""}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingForgetAll(true)}
          >
            Forget everything
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingForgetAll}
        title="Forget everything Jami remembers?"
        description="Every note on this list is deleted. Your chats and your teaching settings stay as they are."
        confirmLabel="Forget everything"
        busy={busy}
        onConfirm={() => {
          void memory.forgetAll().then(() => setConfirmingForgetAll(false));
        }}
        onClose={() => setConfirmingForgetAll(false)}
      />
    </div>
  );
}
