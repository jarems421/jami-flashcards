"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ButtonLink, Card, Skeleton } from "@/components/ui";
import RevisionEmblem from "@/components/revision/RevisionEmblem";
import RevisionNextSteps from "@/components/revision/RevisionNextSteps";
import { useUser } from "@/components/providers/UserProvider";
import { getRevisionStartHref } from "@/lib/app/routes";
import { REVISION_SHELF_TITLE, type RevisionShelfItem } from "@/lib/revision/shelf";
import { listRevisionShelf } from "@/services/learning/revision-shelf";

const TUTOR_HREF = "/dashboard/tutor";

/**
 * Revision Sessions on the Tutor page: a way in, and the shelf.
 *
 * The shelf holds what the student kept from their sessions -- things saved for
 * later, and cards and practice Jami wrote that they chose to keep. It is a
 * to-do list rather than a library: an item leaves it once it is done, and what
 * Jami made lives with the rest of the folder's work, linked from here.
 */
export default function RevisionTutorShelf() {
  const { user } = useUser();
  const [items, setItems] = useState<RevisionShelfItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listRevisionShelf(user.uid)
      .then((loaded) => {
        if (cancelled) return;
        setItems(loaded);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [revision, user.uid]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const later = (items ?? []).filter((item) => item.status === "later");
  const made = (items ?? []).filter((item) => item.status === "made");

  return (
    <Card padding="md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-warm-border bg-warm-glow text-warm-accent shadow-warm">
            <RevisionEmblem className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-text-primary">Revision sessions</p>
            <p className="mt-0.5 text-sm leading-6 text-text-secondary">
              Jami teaches one thing properly. You do the thinking, and every answer is checked.
            </p>
          </div>
        </div>
        <ButtonLink href={getRevisionStartHref({ returnHref: TUTOR_HREF })} className="shrink-0">
          Start a session
        </ButtonLink>
      </div>

      {items === null && !failed ? (
        <div className="mt-5 space-y-2">
          <Skeleton className="h-16" />
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="mt-4 text-sm text-text-secondary">
          Your saved sessions couldn&apos;t be loaded just now.
        </p>
      ) : null}

      {later.length > 0 ? (
        <div className="mt-5">
          <RevisionNextSteps
            heading="Saved for later"
            items={later.map((item) => ({
              shelfId: item.id,
              step: {
                kind: item.kind,
                reason: "",
                topicKey: item.topicKey,
                conceptLabel: item.conceptLabel,
                folderId: item.folderId,
                ...(item.conceptId ? { conceptId: item.conceptId } : {}),
                ...(item.href ? { href: item.href } : {}),
              },
            }))}
            interventionId="revision-shelf"
            onShelfChange={refresh}
          />
        </div>
      ) : null}

      {made.length > 0 ? (
        <section aria-label="Made for you" className="mt-5 space-y-2">
          <h2 className="text-sm font-medium text-text-muted">Made for you</h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
            {made.map((item, index) => (
              <Link
                key={item.id}
                href={item.href ?? TUTOR_HREF}
                className={`flex min-h-12 items-center justify-between gap-3 px-4 py-3 transition duration-fast hover:bg-[var(--color-glass-subtle)] ${
                  index > 0 ? "border-t border-[var(--color-border)]" : ""
                }`}
              >
                <span className="min-w-0 truncate text-sm text-text-primary">
                  {REVISION_SHELF_TITLE[item.kind](item.conceptLabel)}
                </span>
                <span className="shrink-0 text-xs font-medium text-text-muted">Open</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </Card>
  );
}
