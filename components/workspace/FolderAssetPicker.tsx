"use client";

import { useMemo, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { toggleIdSelection } from "@/lib/app/multi-select";

type FolderAssetPickerItem = {
  id: string;
  label: string;
};

type FolderAssetPickerProps = {
  kind: "deck" | "source";
  items: FolderAssetPickerItem[];
  busy: boolean;
  onAdd: (ids: string[]) => Promise<boolean>;
};

export default function FolderAssetPicker({
  kind,
  items,
  busy,
  onAdd,
}: FolderAssetPickerProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const label = kind === "deck" ? "deck" : "source";
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return items;
    return items.filter((item) => item.label.toLowerCase().includes(normalizedSearch));
  }, [items, search]);

  const add = async () => {
    const added = await onAdd(selectedIds);
    if (!added) return;
    setSelectedIds([]);
    setSearch("");
  };

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Input
          label={`Find ${label}`}
          placeholder={kind === "deck" ? "Search global decks" : "Search saved sources"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          containerClassName="sm:max-w-sm"
        />
        <Button
          type="button"
          disabled={selectedIds.length === 0 || busy}
          onClick={() => void add()}
        >
          {busy ? "Adding..." : "Add to folder"}
        </Button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {filtered.length > 0 ? (
          filtered.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setSelectedIds((current) => toggleIdSelection(current, item.id))
                }
                className={`rounded-md border px-3 py-3 text-left text-sm transition ${
                  selected
                    ? "border-warm-border bg-warm-glow text-text-primary"
                    : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary"
                }`}
              >
                {item.label}
              </button>
            );
          })
        ) : (
          <p className="text-sm text-text-muted">No global {label}s to add.</p>
        )}
      </div>
    </Card>
  );
}
