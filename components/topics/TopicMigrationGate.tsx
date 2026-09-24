"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useUser } from "@/components/providers/UserProvider";
import {
  migrateCardTagsToTopics,
  topicMigrationKnownSettled,
} from "@/services/study/topics";

export default function TopicMigrationGate({ children }: { children: ReactNode }) {
  const { user } = useUser();
  // An account this browser has seen migrated renders at once, without the
  // round trip that used to hold every dashboard page behind a spinner.
  const [ready, setReady] = useState(() => topicMigrationKnownSettled(user.uid));

  useEffect(() => {
    let active = true;
    const settled = topicMigrationKnownSettled(user.uid);

    queueMicrotask(() => {
      if (active) setReady(settled);
    });
    if (settled) {
      return () => {
        active = false;
      };
    }
    void migrateCardTagsToTopics(user.uid)
      .catch((error) => {
        console.error("Topic migration failed.", error);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [user.uid]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-label="Preparing Topics">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--color-border)] border-t-accent" />
      </div>
    );
  }

  return children;
}
