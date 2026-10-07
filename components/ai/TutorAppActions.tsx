"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JamiAppScope, TutorAppActionProposal } from "@/lib/ai/jami-app-guide";
import { createDeckFromTutor, createNotebookFromTutor } from "@/services/ai/tutor-app-actions";

type ActionState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; message: string; link?: { href: string; label: string } }
  | { status: "error"; message: string };

/**
 * One run per answer and action, however often the panel mounts: the drawer
 * re-renders while a reply streams, and development mounts effects twice.
 * Every mount follows the same run and shows its result.
 */
const inFlight = new Map<string, Promise<ActionState>>();

type TutorAppActionsProps = {
  userId: string;
  messageKey: string;
  actions: readonly TutorAppActionProposal[];
  scope: JamiAppScope;
  /** Answered in this sitting: what the student asked for runs by itself. */
  fresh: boolean;
  readOnly: boolean;
  /** Supplied by a notebook: adds blank pages at the end and says how many it added. */
  onAddNotebookPages?: (count: number) => Promise<number>;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What Tutor did, or offers to do, in the app, under the answer that said so.
 *
 * A place to open is a link the student presses. Something to make -- pages, a
 * deck, a notebook -- happens straight away when the student asked for it in so
 * many words, and otherwise waits as a button, so Tutor never changes anything
 * nobody asked it to.
 */
export default function TutorAppActions({
  userId,
  messageKey,
  actions,
  scope,
  fresh,
  readOnly,
  onAddNotebookPages,
}: TutorAppActionsProps) {
  const visible = actions.filter((action) => {
    if (action.type === "add_pages") return Boolean(onAddNotebookPages) && !readOnly;
    if (action.type === "create_notebook") return Boolean(scope.folderId) && !readOnly;
    if (action.type === "create_deck") return !readOnly;
    return true;
  });
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-start gap-1.5 px-1">
      {visible.map((action) =>
        action.type === "open" ? (
          <Link
            key={`open:${action.destination}`}
            href={action.href}
            className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          >
            {action.label}
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3 w-3">
              <path d="M7.5 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ) : (
          <MakeAction
            key={action.type}
            userId={userId}
            runKey={`${messageKey}:${action.type}`}
            action={action}
            scope={scope}
            autoRun={fresh && action.autoRun}
            onAddNotebookPages={onAddNotebookPages}
          />
        )
      )}
    </div>
  );
}

function describe(action: Exclude<TutorAppActionProposal, { type: "open" }>) {
  if (action.type === "add_pages") {
    return { idle: `Add ${plural(action.count, "page")}`, running: `Adding ${plural(action.count, "page")}…` };
  }
  if (action.type === "create_deck") {
    return { idle: `Make deck “${action.name}”`, running: "Making the deck…" };
  }
  return { idle: `Make notebook “${action.title}”`, running: "Making the notebook…" };
}

function MakeAction({
  userId,
  runKey,
  action,
  scope,
  autoRun,
  onAddNotebookPages,
}: {
  userId: string;
  runKey: string;
  action: Exclude<TutorAppActionProposal, { type: "open" }>;
  scope: JamiAppScope;
  autoRun: boolean;
  onAddNotebookPages?: (count: number) => Promise<number>;
}) {
  const [state, setState] = useState<ActionState>(() =>
    inFlight.has(runKey) || autoRun ? { status: "running" } : { status: "idle" }
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const perform = async (): Promise<ActionState> => {
    try {
      if (action.type === "add_pages") {
        if (!onAddNotebookPages) throw new Error("Open the notebook to add pages to it.");
        const added = await onAddNotebookPages(action.count);
        return added > 0
          ? { status: "done", message: `Added ${plural(added, "page")} to the end of this notebook.` }
          : { status: "error", message: "No pages could be added just now." };
      }
      if (action.type === "create_deck") {
        const deck = await createDeckFromTutor(userId, { name: action.name, folderId: scope.folderId });
        return {
          status: "done",
          message: `Made the deck “${deck.name}”.`,
          link: { href: `/dashboard/decks/${encodeURIComponent(deck.id)}`, label: "Open deck" },
        };
      }
      if (!scope.folderId) throw new Error("Open a folder to make a notebook in it.");
      const notebook = await createNotebookFromTutor(userId, { title: action.title, folderId: scope.folderId });
      return {
        status: "done",
        message: `Made the notebook “${notebook.title}”.`,
        link: { href: `/dashboard/notebooks/${encodeURIComponent(notebook.id)}`, label: "Open notebook" },
      };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "That could not be done just now." };
    }
  };

  /** Joins the run already under way for this action, or starts one. */
  const follow = (start: boolean) => {
    let pending = inFlight.get(runKey);
    if (!pending && start) {
      pending = perform();
      inFlight.set(runKey, pending);
      // A failure can be tried again; a success stays done for this answer.
      void pending.then((result) => {
        if (result.status === "error") inFlight.delete(runKey);
      });
    }
    if (!pending) return;
    void pending.then((result) => {
      if (mounted.current) setState(result);
    });
  };

  const run = () => {
    setState({ status: "running" });
    follow(true);
  };

  // What the student asked for in so many words runs once, by itself.
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  });
  useEffect(() => {
    if (autoRun || inFlight.has(runKey)) followRef.current(autoRun);
  }, [autoRun, runKey]);

  const words = describe(action);
  if (state.status === "done") {
    return (
      <p className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs leading-5 text-text-primary" role="status">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 text-success">
          <path d="M4 10.5l3.5 3.5L16 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1">{state.message}</span>
        {state.link ? (
          <Link href={state.link.href} className="shrink-0 font-semibold text-accent underline-offset-2 hover:underline">
            {state.link.label}
          </Link>
        ) : null}
      </p>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={state.status === "running"}
        className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 disabled:cursor-wait disabled:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        onClick={run}
      >
        {state.status === "running" ? (
          <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : null}
        {state.status === "running" ? words.running : state.status === "error" ? `Try again: ${words.idle.toLowerCase()}` : words.idle}
      </button>
      {state.status === "error" ? (
        <span className="px-1 text-2xs leading-4 text-[var(--color-error-text)]" role="alert">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
