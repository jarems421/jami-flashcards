"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PLAN_LABELS } from "@/lib/billing/plans";
import { describeSpaceLimit, type SpaceKind } from "@/lib/billing/space";
import { getFolderRoom, getNotebookRoom } from "@/services/billing/space-limits";

/**
 * How much room is left, said before the student fills in the form rather
 * than after they press Create. Nothing at all while there is plenty of room,
 * on a paid plan, or with billing off.
 */
export default function SpaceRoomNotice({
  kind,
  userId,
  folderId,
  className = "",
}: {
  kind: SpaceKind;
  userId: string;
  folderId?: string;
  className?: string;
}) {
  const [room, setRoom] = useState<Awaited<ReturnType<typeof getFolderRoom>>>(null);

  useEffect(() => {
    let cancelled = false;
    const load = kind === "folders" ? getFolderRoom(userId) : folderId ? getNotebookRoom(userId, folderId) : null;
    load
      ?.then((next) => {
        if (!cancelled) setRoom(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, userId, folderId]);

  if (!room || room.left > 1) return null;
  const href = "/dashboard/plans";
  const link = (
    <Link
      href={href}
      className="font-semibold text-text-secondary underline decoration-current/30 underline-offset-4 hover:text-text-primary"
    >
      See plans
    </Link>
  );

  if (room.left === 0) {
    return (
      <div role="status" className={`app-subtle-panel rounded-xl px-4 py-3 text-sm leading-6 text-text-primary ${className}`}>
        {describeSpaceLimit(room.plan, kind)} {link}
      </div>
    );
  }
  return (
    <p role="status" className={`text-xs leading-5 text-text-muted ${className}`}>
      {kind === "folders" ? "This is your last folder" : "This is the last notebook of your own in this folder"} on{" "}
      {PLAN_LABELS[room.plan]}. {PLAN_LABELS.plus} has room for as many as you like. {link}
    </p>
  );
}
