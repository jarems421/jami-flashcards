"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RevisionCanvas,
  RevisionEnded,
  RevisionPreparing,
} from "@/components/revision/RevisionSessionScreen";
import { getRevisionSessionHref } from "@/lib/app/routes";
import { NOTEBOOK_EDITOR_LOCK_BODY_CLASS } from "@/lib/workspace/notebook-interaction-lock";
import { RevisionSessionError, startRevisionSession } from "@/services/learning/revision-sessions";

export type RevisionStart = { actionId: string } | { folderId: string; topicKey: string };

function isEmpty(start: RevisionStart) {
  return "actionId" in start ? !start.actionId : !start.folderId || !start.topicKey;
}

/**
 * Where a "Start session" lands: the session is made, then opened.
 *
 * The link carries a recommendation's id, or a folder and a concept, and the
 * server decides what either means. Replacing rather than pushing, so Back
 * from the session goes to where the student came from and not to a page that
 * would start it again.
 */
export default function RevisionSessionStarter({
  start,
  returnHref,
}: {
  start: RevisionStart;
  /** Where the session should send the student when it is over. */
  returnHref?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    isEmpty(start) ? "There's no session to start here." : null
  );
  const startedRef = useRef(false);
  const actionId = "actionId" in start ? start.actionId : "";
  const folderId = "folderId" in start ? start.folderId : "";
  const topicKey = "topicKey" in start ? start.topicKey : "";

  useEffect(() => {
    document.body.classList.add(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
    return () => document.body.classList.remove(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
  }, []);

  useEffect(() => {
    if (!(actionId || (folderId && topicKey)) || startedRef.current) return;
    startedRef.current = true;
    // Starting twice is harmless: the server resumes the open session for the
    // same recommendation or concept rather than making a second one.
    startRevisionSession(actionId || { folderId, topicKey })
      .then((session) => router.replace(getRevisionSessionHref(session.id, returnHref)))
      .catch((caught: unknown) =>
        setError(
          caught instanceof RevisionSessionError
            ? caught.message
            : "Jami couldn't start this session just now."
        )
      );
  }, [actionId, folderId, topicKey, returnHref, router]);

  return (
    <RevisionCanvas session={null} returnHref={returnHref}>
      {error ? (
        <RevisionEnded title="This session couldn't start." detail={error} returnHref={returnHref} />
      ) : (
        <RevisionPreparing label="Getting your session ready" />
      )}
    </RevisionCanvas>
  );
}
