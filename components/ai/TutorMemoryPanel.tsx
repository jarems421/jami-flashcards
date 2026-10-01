"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import TutorMemoryMap, { canDrawMemoryMap } from "@/components/ai/memory-map/TutorMemoryMap";
import {
  Button,
  ConfirmDialog,
  FeedbackBanner,
  Input,
  OptionSwitch,
  SettingSwitch,
  Skeleton,
} from "@/components/ui";
import type { useTutorMemory } from "@/hooks/useTutorMemory";
import type { MemoryMapFolderInput } from "@/lib/ai/memory-map";
import {
  describeTimeAgo,
  MAX_TUTOR_MEMORY_TEXT_LENGTH,
  TUTOR_MEMORY_KIND_LABELS,
  TUTOR_MEMORY_KINDS,
  type TutorMemoryKind,
} from "@/lib/ai/tutor-memory";
import type { TutorMemoryEntry } from "@/services/ai/tutor-memory";

const KIND_HINTS: Record<TutorMemoryKind, string> = {
  mistake: "Jami checks for these when your work touches them. They stay the longest.",
  struggle: "Jami offers help with these when they come up.",
  plan: "Picked up in your next chat, then let go after two days.",
  goal: "What Jami keeps in mind when it suggests what to do next.",
  preference: "Your teaching settings still win if the two disagree.",
  context: "Facts about your course that save you repeating yourself.",
  strength: "So Jami doesn't re-teach what you already know.",
};

/** "Fades in 5 days", or nothing for a memory that is about to be confirmed anyway. */
function describeFading(item: TutorMemoryEntry, now: number) {
  if (!item.fadesAt) return "";
  const days = Math.max(0, Math.ceil((item.fadesAt - now) / (24 * 60 * 60 * 1000)));
  return days <= 1 ? "fades within a day" : `fades in ${days} days unless it comes up again`;
}

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
        <p className="pb-0.5 text-2xs text-text-muted">
          {[describeTimeAgo(item.updatedAt, now), describeFading(item, now)].filter(Boolean).join(" · ")}
        </p>
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
  /** The student's folders, so the map can name each subject's galaxy. */
  folders: readonly MemoryMapFolderInput[];
  /** `compact` inside the settings drawer, `comfortable` on the full page. */
  density?: "comfortable" | "compact";
};

type MemoryView = "map" | "list";

/** Whether the map can be drawn never changes while the page is open. */
const subscribeToNothing = () => () => {};

const VIEW_OPTIONS = [
  { value: "map", label: "Map" },
  { value: "list", label: "List" },
] as const;

/**
 * What Jami remembers across chats, and the student's say over it.
 *
 * Everything Tutor carries from one chat to the next is here, in the words
 * Tutor will read it in: as a map of the student's subjects by default, or as
 * a plain list. A student can correct or forget any note from either, forget
 * all of it, or switch memory off -- which stops it being used or added to
 * straight away.
 */
export default function TutorMemoryPanel({ memory, folders, density = "comfortable" }: TutorMemoryPanelProps) {
  const [confirmingForgetAll, setConfirmingForgetAll] = useState(false);
  const [shown, setShown] = useState<MemoryView>("map");
  // Known only in the browser; until then nothing is drawn rather than the
  // wrong view, and where the map cannot be drawn the list is all there is.
  const mapSupported = useSyncExternalStore<boolean | null>(subscribeToNothing, canDrawMemoryMap, () => null);
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

  const groups = TUTOR_MEMORY_KINDS.map((kind) => ({
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
        description="Jami keeps short notes from your chats — what you get wrong, what you find hard, what you're working on next — so every chat picks up where the last one left off. Notes fade unless they come up again."
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

      {mapSupported ? (
        <OptionSwitch
          label="Show memory as"
          hideLabel
          value={shown}
          options={VIEW_OPTIONS}
          onChange={setShown}
        />
      ) : null}

      {mapSupported === null ? (
        <Skeleton className={`w-full rounded-3xl ${compact ? "h-[440px]" : "h-[420px]"}`} />
      ) : mapSupported && shown === "map" ? (
        <TutorMemoryMap
          items={view.items}
          folders={folders}
          compact={compact}
          onEdit={(id, text) => void memory.edit(id, text)}
          onForget={(id) => void memory.forget(id)}
        />
      ) : groups.length === 0 ? (
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
