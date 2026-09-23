"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, EmptyState, Input, Skeleton } from "@/components/ui";
import RevisionEmblem from "@/components/revision/RevisionEmblem";
import { useUser } from "@/components/providers/UserProvider";
import { getFolderHref, getRevisionStartHref } from "@/lib/app/routes";
import type { RevisionConceptOption } from "@/lib/revision/options";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getRevisionOptions, RevisionSessionError } from "@/services/learning/revision-sessions";
import { getActiveStudyFolders } from "@/services/study/folders";

type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; message: string };

/** The student's own Topics, when a folder has them beside its course. */
const OWN_TOPICS = "Your topics";

/**
 * Choosing what to revise.
 *
 * One folder at a time, because a session is taught at the pitch of one
 * course. Inside it, one list: what Jami suggests first, then the course's
 * concepts under the headings the board prints them under, then the student's
 * own Topics. A search box, because a course can list a hundred concepts and
 * the student usually knows the one they mean.
 */
export default function RevisionStartPicker({
  folderId,
  returnHref,
}: {
  folderId?: string;
  returnHref?: string;
}) {
  return folderId ? (
    <ConceptPicker folderId={folderId} returnHref={returnHref} />
  ) : (
    <FolderPicker returnHref={returnHref} />
  );
}

function Intro() {
  return (
    <Card tone="warm" padding="md">
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-warm-border bg-warm-glow text-warm-accent shadow-warm">
          <RevisionEmblem className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-warm-accent">
            Revision session
          </p>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Jami teaches it, you do the thinking, and every answer is checked. About 15 minutes.
          </p>
        </div>
      </div>
    </Card>
  );
}

function FolderPicker({ returnHref }: { returnHref?: string }) {
  const { user } = useUser();
  const [folders, setFolders] = useState<Loaded<StudyFolder[]>>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    getActiveStudyFolders(user.uid)
      .then((value) => !cancelled && setFolders({ state: "ready", value }))
      .catch(() => !cancelled && setFolders({ state: "failed", message: "Your folders couldn't be loaded." }));
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  return (
    <div className="space-y-4">
      <Intro />
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-text-muted">Which subject?</h2>
        {folders.state === "loading" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : folders.state === "failed" ? (
          <p role="alert" className="text-sm text-text-secondary">{folders.message}</p>
        ) : folders.value.length === 0 ? (
          <EmptyState
            emoji="📁"
            title="Make a folder first"
            description="A session is taught at the level of one subject, so it starts from a folder."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {folders.value.map((folder) => (
              <Link
                key={folder.id}
                href={getRevisionStartHref({ folderId: folder.id, returnHref })}
                className="app-subtle-panel flex min-h-16 items-center justify-between gap-3 rounded-2xl px-4 py-3 transition duration-fast hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium text-text-primary">{folder.name}</span>
                  {folder.examCourse ? (
                    <span className="block truncate text-xs text-text-muted">
                      {[folder.examCourse.board, folder.examCourse.qualification].filter(Boolean).join(" ")}
                    </span>
                  ) : null}
                </span>
                <ChevronGlyph />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ConceptPicker({ folderId, returnHref }: { folderId: string; returnHref?: string }) {
  const [loaded, setLoaded] = useState<
    Loaded<{ folder: { id: string; name: string }; options: RevisionConceptOption[] }>
  >({ state: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getRevisionOptions(folderId)
      .then((value) => !cancelled && setLoaded({ state: "ready", value }))
      .catch(
        (error: unknown) =>
          !cancelled &&
          setLoaded({
            state: "failed",
            message:
              error instanceof RevisionSessionError
                ? error.message
                : "Jami couldn't list this folder's topics just now.",
          })
      );
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  const options = useMemo(
    () => (loaded.state === "ready" ? loaded.value.options : []),
    [loaded]
  );
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.group?.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const suggested = query.trim() ? [] : matching.filter((option) => option.suggested);
  const groups = useMemo(() => {
    const byGroup = new Map<string, RevisionConceptOption[]>();
    for (const option of matching) {
      if (!query.trim() && option.suggested) continue;
      const group = option.source === "student-topic" ? OWN_TOPICS : option.group ?? "Other";
      byGroup.set(group, [...(byGroup.get(group) ?? []), option]);
    }
    return [...byGroup.entries()];
  }, [matching, query]);

  const startHref = (option: RevisionConceptOption) =>
    getRevisionStartHref({ folderId, topicKey: option.topicKey, returnHref });

  return (
    <div className="space-y-5">
      <Intro />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-text-secondary">
          {loaded.state === "ready" ? (
            <>
              Revising in <span className="font-medium text-text-primary">{loaded.value.folder.name}</span>
            </>
          ) : (
            "Revising"
          )}
        </p>
        <Link
          href={getRevisionStartHref({ returnHref })}
          className="rounded-full px-3 py-1.5 text-sm font-medium text-text-muted underline-offset-4 transition duration-fast hover:text-text-primary hover:underline"
        >
          Change subject
        </Link>
      </div>

      {loaded.state === "loading" ? (
        <div className="space-y-2">
          <Skeleton className="h-11" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : loaded.state === "failed" ? (
        <p role="alert" className="text-sm text-text-secondary">{loaded.message}</p>
      ) : options.length === 0 ? (
        <EmptyState
          emoji="🧭"
          title="Nothing to revise here yet"
          description="Give this folder a course, or add Topics to it, and they'll appear here."
          action={
            <Link href={getFolderHref(folderId)} className="text-sm font-medium text-text-primary underline underline-offset-4">
              Open the folder
            </Link>
          }
        />
      ) : (
        <>
          <Input
            type="search"
            aria-label="Search topics"
            placeholder="Search topics"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {suggested.length > 0 ? (
            <section className="space-y-2.5">
              <h2 className="text-sm font-medium text-text-muted">Jami suggests</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggested.map((option) => (
                  <Link
                    key={option.topicKey}
                    href={startHref(option)}
                    className="app-panel-warm group flex min-h-20 items-center gap-3 rounded-2xl p-4 transition duration-fast hover:-translate-y-px"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-warm-border bg-warm-glow text-warm-accent">
                      <RevisionEmblem className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-medium leading-6 text-text-primary">{option.label}</span>
                      {option.group ? (
                        <span className="block truncate text-xs text-text-muted">{option.group}</span>
                      ) : null}
                    </span>
                    <ChevronGlyph />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {groups.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing in this folder matches that.</p>
          ) : (
            groups.map(([group, members]) => (
              <section key={group} className="space-y-2">
                <h2 className="text-sm font-medium text-text-muted">{group}</h2>
                <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
                  {members.map((option, index) => (
                    <Link
                      key={option.topicKey}
                      href={startHref(option)}
                      className={`flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-sm text-text-primary transition duration-fast hover:bg-[var(--color-glass-subtle)] ${
                        index > 0 ? "border-t border-[var(--color-border)]" : ""
                      }`}
                    >
                      <span className="min-w-0">{option.label}</span>
                      <ChevronGlyph />
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted">
      <path d="M7.5 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
