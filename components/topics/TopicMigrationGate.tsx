"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useUser } from "@/lib/auth/user-context";
import { migrateCardTagsToTopics } from "@/services/study/topics";

export default function TopicMigrationGate({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) setReady(false);
    });
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
