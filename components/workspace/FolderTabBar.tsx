"use client";

import { featureFlags } from "@/lib/app/feature-flags";
import type { FolderWorkspaceTab } from "@/lib/workspace/folder-navigation";

/** The folder's sections: notebooks, past-paper practice, decks and sources. */
export default function FolderTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: FolderWorkspaceTab;
  onSelect: (tab: FolderWorkspaceTab) => void;
}) {
  const tabs: Array<{ value: FolderWorkspaceTab; label: string }> = [
    { value: "notebooks", label: "Notebooks" },
    ...(featureFlags.enablePastPaperPractice
      ? [{ value: "practice" as const, label: "Practice" }]
      : []),
    { value: "decks", label: "Decks" },
    { value: "sources", label: "Sources" },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-1">
      {tabs.map(({ value, label }) => {
        const selected = activeTab === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            className={`min-h-[2.4rem] rounded-full px-4 text-sm font-semibold transition ${
              selected
                ? "bg-accent text-[var(--color-text-inverse)] shadow-accent"
                : "text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
