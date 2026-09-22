"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, IconBubble, SectionHeader } from "@/components/ui";
import { usePersistentDisclosure } from "@/lib/app/disclosure-preference";

/**
 * The road to the first review, for a student who has not walked it yet.
 *
 * It sits below the mission rather than above it. The whole point of the
 * mission is that Jami already knows what to do next -- for a brand new
 * student that is "create your first folder", and for everyone else it is
 * their actual review -- so putting setup scaffolding on top of it made the
 * page bury its own answer.
 *
 * It stops at the first review on purpose. It used to carry "set a goal" and
 * "earn a star" too, which are good things but are not what stands between a
 * student and studying; because most students never do them the list never
 * completed and the card never went away.
 */

const DISMISSED_KEY = "jami:getting-started-complete-dismissed";
const OPEN_STORAGE_KEY = "jami:getting-started-open";

export type ChecklistItem = {
  label: string;
  detail: string;
  href: string;
  done: boolean;
};

export default function GettingStartedChecklist({
  items,
  isLoading,
  defaultOpen,
}: {
  items: ChecklistItem[];
  isLoading: boolean;
  defaultOpen: boolean;
}) {
  const [open, toggleOpen] = usePersistentDisclosure(OPEN_STORAGE_KEY, defaultOpen);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      // Storage can be blocked by browser privacy settings; showing the
      // checklist again is the safe non-persistent fallback.
      return false;
    }
  });
  const allDone = !isLoading && items.length > 0 && items.every((item) => item.done);
  const showComplete = allDone && !dismissed;

  useEffect(() => {
    if (!showComplete) return;

    const timeoutId = window.setTimeout(() => {
      setDismissed(true);
      try {
        sessionStorage.setItem(DISMISSED_KEY, "true");
      } catch {
        // The dismissal still applies for this render when browser storage is
        // blocked; it simply cannot persist across navigation.
      }
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [showComplete]);

  if (allDone && dismissed) return null;

  if (showComplete) {
    return (
      <Card tone="warm" padding="lg" className="animate-reward-pulse">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
              Getting started complete
            </div>
            <div className="mt-2 text-xl font-semibold text-text-primary">You are ready.</div>
          </div>
          <IconBubble
            size="lg"
            shape="circle"
            className="h-16 w-16 border border-warm-border bg-warm-glow"
          >
            <span className="h-8 w-8 rounded-full bg-warm-accent shadow-warm" />
          </IconBubble>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader title="Getting started" />
        <Button type="button" onClick={toggleOpen} variant="secondary" size="sm" aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {items.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={`app-subtle-panel flex min-h-[5rem] items-center gap-3 rounded-lg p-3 transition duration-fast hover:-translate-y-[1px] ${
                item.done ? "app-selected" : ""
              }`}
            >
              <IconBubble
                size="md"
                shape="circle"
                className={`shrink-0 font-semibold ${item.done ? "app-success" : "app-chip"}`}
                aria-label={item.done ? "Complete" : `Step ${index + 1}`}
              >
                {item.done ? "✓" : index + 1}
              </IconBubble>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 text-text-secondary">
                  {item.detail}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  item.done ? "app-success" : "app-chip"
                }`}
              >
                {item.done ? "Done" : "Start"}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
