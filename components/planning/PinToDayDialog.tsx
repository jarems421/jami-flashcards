"use client";

import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
} from "@/components/ui";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import type { PinnedPlanItem } from "@/lib/planning/types";

/**
 * Putting one specific thing on one specific day.
 *
 * The plan deliberately does not decide content ahead of time -- work written
 * out three weeks early is wrong by the time it arrives, because the student
 * has learned some of it and the list knows neither. A pin is the honest
 * exception: it is not a prediction about what will be useful on Thursday, it
 * is the student saying they intend to do this on Thursday, and that is a fact
 * about their intentions rather than a guess about their knowledge.
 *
 * So pinned items survive the engine changing its mind, and they take the front
 * of the day. They are also not evidence of anything: nothing here reaches a
 * learner profile.
 */

/** Beyond this a day is a backlog, and the cap in `resolvePlanDay` is the real one. */
const MAX_PINNED_PER_DAY = 4;

export type PinToDayDialogProps = {
  open: boolean;
  /**
   * Which day this is, in words.
   *
   * The day *key* is not a prop: the parent keys the whole dialog on it, so
   * opening this on Thursday mounts a fresh one rather than leaving what was
   * half-typed for Tuesday in the box.
   */
  dayLabel: string;
  /** What the engine currently suggests, as ready-made things to pin. */
  actions: readonly StudyAction[];
  existing: readonly PinnedPlanItem[];
  saving?: boolean;
  onPin: (item: PinnedPlanItem) => void;
  onUnpin: (actionId: string) => void;
  onClose: () => void;
};

export default function PinToDayDialog({
  open,
  dayLabel,
  actions,
  existing,
  saving = false,
  onPin,
  onUnpin,
  onClose,
}: PinToDayDialogProps) {
  const [label, setLabel] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const pinnedIds = new Set(existing.map((item) => item.actionId));
  const full = existing.length >= MAX_PINNED_PER_DAY;
  const suggestions = actions.filter((action) => action.destination).slice(0, 6);

  const addTyped = () => {
    const said = label.trim();
    if (!said || full) return;
    onPin({
      // Its own namespace, so a typed note can never collide with an engine
      // action id and quietly suppress a real recommendation.
      actionId: `manual:${Date.now().toString(36)}`,
      label: said.slice(0, 80),
    });
    setLabel("");
  };

  return (
    <Dialog
      open={open}
      dismissible={!saving}
      initialFocusRef={closeRef}
      className="fixed inset-0 flex items-end justify-center p-4 sm:items-center"
      onDismiss={onClose}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative w-full max-w-lg rounded-xl p-5 shadow-e3 sm:p-6">
        <DialogTitle className="text-xl font-semibold text-text-primary">
          Add to {dayLabel}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-text-secondary">
          Anything you add here goes to the front of that day. The rest of the day
          is still chosen from your recent work when it arrives.
        </DialogDescription>

        {existing.length > 0 ? (
          <ul className="mt-5 space-y-1.5">
            {existing.map((item) => (
              <li
                key={item.actionId}
                className="app-subtle-panel flex items-center gap-3 rounded-lg px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                  {item.label}
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onUnpin(item.actionId)}
                  className="shrink-0 rounded-full px-2 py-1 text-2xs font-semibold text-text-muted transition duration-fast hover:text-[var(--color-error-text)] disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {suggestions.length > 0 ? (
          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              From what Jami suggests
            </h3>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {suggestions.map((action) => {
                const already = pinnedIds.has(action.id);
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      disabled={saving || already || full}
                      onClick={() =>
                        onPin({
                          actionId: action.id,
                          label: action.target.label,
                          ...(action.destination ? { href: action.destination.href } : {}),
                        })
                      }
                      className={`min-h-11 rounded-full border px-3.5 text-xs font-semibold transition duration-fast disabled:cursor-not-allowed ${
                        already ? "app-selected" : "app-chip"
                      }`}
                    >
                      {action.target.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="mt-5">
          <Input
            label="Or write your own"
            value={label}
            maxLength={80}
            disabled={saving || full}
            placeholder="Finish the Macbeth essay"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTyped();
              }
            }}
          />
        </div>

        {full ? (
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            That day is full. Remove something first — four things in a sitting is
            already a long evening.
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={closeRef} type="button" variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button type="button" disabled={saving || full || !label.trim()} onClick={addTyped}>
            Add it
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
