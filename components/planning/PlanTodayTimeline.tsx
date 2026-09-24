"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { planSessionFocus, planTask, type PlanSuggestionResult, type PlanTask } from "@/lib/planning/plan-tasks";
import type { PlanDay, PlanDaySession, PlanSlot } from "@/lib/planning/types";

/**
 * A day of the plan, read down a time rail.
 *
 * Each sitting shows when it is, which subject, what it is about, and the work
 * in it -- and every piece of work says whether Jami suggested it or the
 * student put it there, because only the second kind stays put. The student can
 * tick things off, add their own task to a sitting, or ask Jami for another.
 *
 * Used by the planner and by Home, so a day reads the same wherever it is.
 */

export type PlanTodayTimelineProps = {
  day: PlanDay;
  title: string;
  summary?: string;
  scopeNames: ReadonlyMap<string, string>;
  scopeColor: (scopeKey: string) => string;
  /** Whether this day is today: only today has Jami's suggestions in it. */
  isToday: boolean;
  /** Whether this day has gone, so an empty place says so rather than promising to fill itself. */
  isPast?: boolean;
  /** The slot shown as "Up next", when the page leads with it. */
  upNextSlotId?: string;
  onToggle: (slot: PlanSlot) => void;
  onAddOwnTask?: (sessionId: string, label: string) => boolean;
  onAskJami?: (session: PlanDaySession) => PlanSuggestionResult;
  onRemoveTask?: (actionId: string) => void;
};

function TickMark({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition duration-normal ease-spring ${
        done
          ? "scale-105 border-transparent bg-[var(--color-success)] text-text-inverse"
          : "border-[var(--color-border-strong)] text-transparent group-hover:border-[var(--color-success)]"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function tagFor(task: PlanTask, upNext: boolean) {
  if (task.slot.completedBy === "activity") return { text: "Done · Jami saw this", tone: "text-[var(--color-success)]" };
  if (upNext) return { text: "Up next", tone: "text-[var(--color-success)]" };
  if (task.source === "you") return { text: "You added", tone: "text-[var(--color-warning)]" };
  if (task.source === "jami") return { text: "Jami suggested", tone: "text-[var(--color-accent)]" };
  return null;
}

function TaskRow({
  task,
  isToday,
  isPast,
  upNext,
  onToggle,
  onRemove,
}: {
  task: PlanTask;
  isToday: boolean;
  isPast: boolean;
  upNext: boolean;
  onToggle: (slot: PlanSlot) => void;
  onRemove?: (actionId: string) => void;
}) {
  const { slot } = task;
  const done = slot.state === "done";
  const open = task.source === "open";
  const label = open
    ? isToday
      ? "Open study time"
      : isPast
        ? "Nothing was picked"
        : "Jami fills this in on the day"
    : task.label;
  const locked = slot.completedBy === "activity" || slot.state === "skipped" || open;
  const tag = tagFor(task, upNext);
  const text = (
    <span
      className={`min-w-0 flex-1 text-sm leading-snug transition ${
        done
          ? "text-text-muted line-through decoration-[var(--color-border-strong)]"
          : open
            ? "text-text-muted"
            : "text-text-primary"
      }`}
    >
      {label}
    </span>
  );
  return (
    <li
      className={`group flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition duration-fast ${
        upNext
          ? "border-[var(--color-success)] bg-[var(--color-success-muted)]"
          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Mark done: ${label}`}
        disabled={locked}
        onClick={() => onToggle(slot)}
        className="-m-1 grid shrink-0 place-items-center rounded-full p-1 transition duration-fast ease-spring active:scale-90 disabled:cursor-default disabled:opacity-70 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
      >
        <TickMark done={done} />
      </button>
      {task.href && !done ? (
        <Link
          href={task.href}
          className="flex min-w-0 flex-1 rounded-lg hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        >
          {text}
        </Link>
      ) : (
        text
      )}
      {tag ? <span className={`hidden shrink-0 text-2xs font-semibold sm:inline ${tag.tone}`}>{tag.text}</span> : null}
      {onRemove && slot.item.kind === "pinned" ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={() => slot.item.kind === "pinned" && onRemove(slot.item.pinned.actionId)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        >
          <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </li>
  );
}

function AddTask({
  session,
  subject,
  onAddOwnTask,
  onAskJami,
}: {
  session: PlanDaySession;
  subject: string;
  onAddOwnTask?: (sessionId: string, label: string) => boolean;
  onAskJami?: (session: PlanDaySession) => PlanSuggestionResult;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  if (!onAddOwnTask && !onAskJami) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onAddOwnTask?.(session.id, text)) {
      setText("");
      setNote("");
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        {onAddOwnTask ? (
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-dashed border-[var(--color-border-strong)] px-3 focus-within:border-[var(--color-accent)]">
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <label className="sr-only" htmlFor={`add-task-${session.id}`}>
              Add your own task to {subject}
            </label>
            <input
              id={`add-task-${session.id}`}
              value={text}
              maxLength={120}
              onChange={(event) => setText(event.target.value)}
              placeholder="Add your own task"
              className="min-h-[2.75rem] min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            {text.trim() ? (
              <button type="submit" className="shrink-0 text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]">
                Add
              </button>
            ) : null}
          </form>
        ) : null}
        {onAskJami ? (
          <button
            type="button"
            onClick={() => {
              const result = onAskJami(session);
              setNote(
                result === "nothing"
                  ? `Jami has nothing else for ${subject} right now.`
                  : result === "busy"
                    ? "Still saving your last change. Try again in a moment."
                    : ""
              );
            }}
            className="min-h-[2.75rem] shrink-0 rounded-2xl border border-[var(--color-border)] px-3 text-sm font-semibold text-[var(--color-accent)] transition hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          >
            Ask Jami for one
          </button>
        ) : null}
      </div>
      {note ? <p className="px-1 text-xs text-text-muted" role="status">{note}</p> : null}
    </div>
  );
}

function SessionRow({
  session,
  last,
  props,
}: {
  session: PlanDaySession;
  last: boolean;
  props: PlanTodayTimelineProps;
}) {
  const subject = props.scopeNames.get(session.scopeKey) ?? "Study";
  const focus = planSessionFocus(session);
  const color = props.scopeColor(session.scopeKey);
  return (
    <li className="grid grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[3.75rem_1.5rem_minmax(0,1fr)] sm:gap-x-3">
      <div className="pt-0.5 text-right">
        <p className="text-sm font-bold tabular-nums text-text-primary">
          {session.startTime ?? (props.day.sessions.length > 1 ? `#${session.index + 1}` : "—")}
        </p>
        <p className="text-2xs tabular-nums text-text-muted">{session.minutes} min</p>
      </div>
      <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 0 4px var(--color-surface-base), 0 0 0 5px ${color}` }}
        />
        {last ? null : <span className="mt-2 w-px flex-1 bg-[var(--color-border-strong)]" />}
      </div>
      <div className={`min-w-0 space-y-2.5 ${last ? "pb-1" : "pb-8"}`}>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-2xs font-bold uppercase tracking-[0.12em] text-text-secondary">{subject}</span>
          {focus ? <h3 className="text-base font-bold text-text-primary">{focus}</h3> : null}
        </div>
        <ul className="space-y-2">
          {session.slots.map((slot) => (
            <TaskRow
              key={slot.id}
              task={planTask(slot)}
              isToday={props.isToday}
              isPast={props.isPast ?? false}
              upNext={slot.id === props.upNextSlotId}
              onToggle={props.onToggle}
              {...(props.onRemoveTask ? { onRemove: props.onRemoveTask } : {})}
            />
          ))}
        </ul>
        <AddTask
          session={session}
          subject={subject}
          {...(props.onAddOwnTask ? { onAddOwnTask: props.onAddOwnTask } : {})}
          {...(props.onAskJami && props.isToday ? { onAskJami: props.onAskJami } : {})}
        />
      </div>
    </li>
  );
}

export default function PlanTodayTimeline(props: PlanTodayTimelineProps) {
  const { day } = props;
  const hasSessions = day.scheduled && day.sessions.length > 0;
  return (
    <section aria-label={props.title} className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xl font-bold tracking-tight text-text-primary">{props.title}</h2>
        {props.summary ? <p className="text-sm text-text-muted">{props.summary}</p> : null}
      </div>
      {day.skipped ? (
        <p className="app-subtle-panel rounded-2xl px-4 py-3 text-sm text-text-secondary">You took this day off.</p>
      ) : hasSessions ? (
        <ol>
          {day.sessions.map((session, index) => (
            <SessionRow key={session.id} session={session} last={index === day.sessions.length - 1} props={props} />
          ))}
        </ol>
      ) : (
        <p className="app-subtle-panel rounded-2xl px-4 py-3 text-sm text-text-secondary">Nothing planned for this day.</p>
      )}
    </section>
  );
}
